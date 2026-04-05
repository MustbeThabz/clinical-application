import { NextResponse } from "next/server"
import { getClinicalFlowById, reassignOpenClinicalFlowTasksForPatient, updateClinicalFlowHandler, writeAuditLogSafe } from "@/lib/backend/db"
import { getClinicalStageAllowedRoles, getRoleLabel, requireRole } from "@/lib/backend/auth"
import type { ClinicalFlowStage } from "@/lib/backend/types"
import { canUserHandleClinicalStage } from "@/lib/roles"
import { getUserById, updateUserAvailability } from "@/lib/backend/users"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: Context) {
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

  const { id } = await context.params
  const flow = await getClinicalFlowById(id)
  if (!flow) {
    return NextResponse.json({ error: "Clinical flow not found" }, { status: 404 })
  }
  if (flow.status !== "active") {
    return NextResponse.json({ error: "Only active clinical flows can be reassigned." }, { status: 400 })
  }

  const currentStage = flow.currentStage as ClinicalFlowStage

  try {
    const body = (await request.json()) as { userId?: string; claimSelf?: boolean }
    const targetUserId = body.claimSelf ? auth.context.userId : body.userId
    if (!targetUserId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 })
    }

    const targetUser = await getUserById(targetUserId)
    if (!targetUser) {
      return NextResponse.json({ error: "Clinician not found or inactive" }, { status: 404 })
    }

    if (!targetUser.isOnDuty || (targetUser.availabilityStatus ?? "available") === "away") {
      return NextResponse.json({ error: "Clinician must be on duty and not away." }, { status: 400 })
    }

    if (!canUserHandleClinicalStage(targetUser.role, currentStage, targetUser.assignedStages)) {
      const allowed = getClinicalStageAllowedRoles(currentStage).map((role) => getRoleLabel(role)).join(" or ")
      return NextResponse.json(
        { error: `Only ${allowed} with assignment to the ${currentStage} stage can own this patient.` },
        { status: 400 },
      )
    }

    const previousHandlerUserId =
      typeof flow.currentHandlerUserId === "string" ? flow.currentHandlerUserId : undefined

    if (previousHandlerUserId && previousHandlerUserId !== targetUser.id) {
      await updateUserAvailability(previousHandlerUserId, {
        isOnDuty: true,
        availabilityStatus: "available",
      })
    }

    await updateUserAvailability(targetUser.id, {
      isOnDuty: true,
      availabilityStatus: "busy_with_patient",
    })

    const updated = await updateClinicalFlowHandler({
      flowId: id,
      userId: targetUser.id,
      name: targetUser.name,
      role: targetUser.role,
    })
    await reassignOpenClinicalFlowTasksForPatient(String(flow.patientId), targetUser.id, targetUser.name)

    await writeAuditLogSafe({
      entityType: "clinic_flow",
      entityId: id,
      action: `rbac_clinical_flow_reassign:${auth.context.role}:${targetUser.role}`,
      actorType: "provider",
    })

    return NextResponse.json({ data: updated })
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
  }
}
