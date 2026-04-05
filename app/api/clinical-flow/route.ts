import { NextResponse } from "next/server"
import { createOrReuseClinicalTask, listClinicalFlows, listClinicalFlowStages, listPatients, startClinicalFlow, writeAuditLogSafe } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"
import { listUsers, updateUserAvailability } from "@/lib/backend/users"
import { canUserHandleClinicalStage, getRoleLabel } from "@/lib/roles"
import { getClinicalFlowTaskTemplate } from "@/lib/clinical-flow"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, [
    "clinic_admin",
    "receptionist_admin",
    "research_assistant",
    "nurse",
    "doctor",
    "lab_personnel",
    "pharmacist",
  ])
  if (!auth.ok) return auth.response

  const [flows, patients, users] = await Promise.all([listClinicalFlows(), listPatients(), listUsers()])
  const activeClinicians = users.filter((user) => user.isActive && user.isOnDuty)
  return NextResponse.json({
    data: flows,
    patients: patients.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      fullName: `${p.firstName} ${p.lastName}`,
      status: p.status,
      nextAppointment: p.nextAppointment,
    })),
    stages: listClinicalFlowStages(),
    clinicians: activeClinicians.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      roleLabel: getRoleLabel(user.role),
      availabilityStatus: user.availabilityStatus ?? "available",
      assignedStages: user.assignedStages ?? [],
    })),
  })
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin"])
  if (!auth.ok) return auth.response

  try {
    const body = (await request.json()) as {
      patientId: string
      appointmentId?: string
      entryMethod?: "scan" | "admin"
    }
    if (!body.patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 })
    }

    const created = await startClinicalFlow({
      patientId: body.patientId,
      appointmentId: body.appointmentId,
      entryMethod: body.entryMethod ?? "admin",
      actor: auth.context.name || auth.context.userId || "dashboard",
      currentHandlerUserId: auth.context.userId,
      currentHandlerName: auth.context.name,
      currentHandlerRole: auth.context.role,
    })
    if (!created) {
      return NextResponse.json({ error: "Failed to start clinical flow" }, { status: 500 })
    }
    await updateUserAvailability(auth.context.userId, {
      isOnDuty: true,
      availabilityStatus: "busy_with_patient",
    })
    const taskTemplate = getClinicalFlowTaskTemplate("request")
    await createOrReuseClinicalTask({
      patientId: String(created.patientId),
      title: taskTemplate.title,
      taskType: taskTemplate.taskType,
      priority: "medium",
      assignedUserId: auth.context.userId,
      assignedUserName: auth.context.name,
      notes: taskTemplate.notes,
    })
    await writeAuditLogSafe({
      entityType: "clinic_flow",
      entityId: String(created.id),
      action: `rbac_clinical_flow_start:${auth.context.role}`,
      actorType: "provider",
    })
    return NextResponse.json({ data: created }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start clinical flow"
    const isPayloadError = message === "patientId is required" || message.includes("JSON")
    return NextResponse.json({ error: message }, { status: isPayloadError ? 400 : 500 })
  }
}
