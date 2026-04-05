import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { createOrReuseClinicalTask, listAlerts, listClinicalFlows, reassignOpenClinicalFlowTasksForPatient, updateAlertStatus, updateClinicalFlowHandler, writeAuditLogSafe } from "@/lib/backend/db"
import { listUsers, updateUserAvailability } from "@/lib/backend/users"
import { getWorkflowEscalationTarget } from "@/lib/clinical-flow"
import { canUserHandleClinicalStage } from "@/lib/roles"
import type { ClinicalFlowStage } from "@/lib/backend/types"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

const STAGE_LABELS: Record<ClinicalFlowStage, string> = {
  request: "Request Received",
  ra: "Ready for RA",
  admin: "Ready for Admin",
  nurse: "Ready for Nurse",
  doctor: "Ready for Doctor",
  lab: "Ready for Lab",
  pharmacy: "Ready for Pharmacy",
}

export async function POST(request: Request, context: Context) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const alerts = await listAlerts({ status: "open", alertType: "workflow" })
  const alert = alerts.find((item) => String(item.id) === id)
  if (!alert) {
    return NextResponse.json({ error: "Open workflow escalation not found" }, { status: 404 })
  }

  const flows = await listClinicalFlows()
  const flow = flows.find((item) => String(item.patientId) === String(alert.patientId) && String(item.status) === "active")
  if (!flow) {
    return NextResponse.json({ error: "Active clinical flow not found for escalation" }, { status: 404 })
  }

  const stage = String(flow.currentStage) as ClinicalFlowStage
  const users = await listUsers()
  const currentOwnerUserId = flow.currentHandlerUserId ? String(flow.currentHandlerUserId) : undefined
  const routeTarget = getWorkflowEscalationTarget(stage, users, currentOwnerUserId)
  if (!routeTarget) {
    return NextResponse.json({ error: "No on-duty escalation lead is currently available" }, { status: 400 })
  }

  const targetUser = users.find((user) => user.id === routeTarget.user.id)
  if (!targetUser || !targetUser.isOnDuty || (targetUser.availabilityStatus ?? "available") === "away") {
    return NextResponse.json({ error: "Recommended lead is no longer available" }, { status: 400 })
  }
  if (!canUserHandleClinicalStage(targetUser.role, stage, targetUser.assignedStages)) {
    return NextResponse.json({ error: "Recommended lead can no longer handle this stage" }, { status: 400 })
  }

  if (currentOwnerUserId && currentOwnerUserId !== targetUser.id) {
    await updateUserAvailability(currentOwnerUserId, {
      isOnDuty: true,
      availabilityStatus: "available",
    })
  }

  await updateUserAvailability(targetUser.id, {
    isOnDuty: true,
    availabilityStatus: "busy_with_patient",
  })

  const updatedFlow = await updateClinicalFlowHandler({
    flowId: String(flow.id),
    userId: targetUser.id,
    name: targetUser.name,
    role: targetUser.role,
  })
  await reassignOpenClinicalFlowTasksForPatient(String(alert.patientId), targetUser.id, targetUser.name)

  const dueMinutes = String(alert.severity) === "critical" ? 15 : 30
  const dueAt = new Date(Date.now() + dueMinutes * 60000).toISOString()
  const task = await createOrReuseClinicalTask({
    patientId: String(alert.patientId),
    title: `Workflow escalation: ${STAGE_LABELS[stage]}`,
    relatedAlertId: id,
    taskType: "outreach",
    priority: String(alert.severity) === "critical" ? "critical" : "high",
    assignedUserId: targetUser.id,
    assignedUserName: targetUser.name,
    dueAt,
    notes: `${alert.title}. Assigned from escalation inbox for ${targetUser.name} (${routeTarget.reason}).`,
  })

  await updateAlertStatus(id, "acknowledged")

  await writeAuditLogSafe({
    entityType: "clinic_flow",
    entityId: String(flow.id),
    action: `rbac_workflow_escalation_assign:${auth.context.role}:${targetUser.role}`,
    actorType: "provider",
  })

  return NextResponse.json({
    data: {
      flow: updatedFlow,
      task,
      assignedTo: {
        userId: targetUser.id,
        name: targetUser.name,
        role: targetUser.role,
      },
    },
  })
}
