import { NextResponse } from "next/server"
import { advanceClinicalFlow, closeClinicalFlowTasksForPatient, createAppointment, createOrReuseClinicalTask, getClinicalFlowById, getPatientById, updateAppointmentStatus, writeAuditLogSafe } from "@/lib/backend/db"
import { getClinicalStageAllowedRoles, getRoleLabel, requireRole } from "@/lib/backend/auth"
import type { ClinicalFlowStage } from "@/lib/backend/types"
import { canUserHandleClinicalStage } from "@/lib/roles"
import { findAvailableClinicianForStage, updateUserAvailability } from "@/lib/backend/users"
import { getClinicalFlowTaskTemplate, getPatientProgramCode, isChronicCareCondition } from "@/lib/clinical-flow"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

async function emitAppointmentScheduledEvent(payload: {
  patient_id: string
  appointment_id: string
  clinic_id: string
  appointment_type: string
  provider_name: string
  scheduled_start: string
}) {
  const baseUrl = process.env.AGENT_SERVICE_URL
  const token = process.env.AGENT_SERVICE_TOKEN
  if (!baseUrl || !token) return

  try {
    await fetch(`${baseUrl}/events/appointment-scheduled`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    })
  } catch {
    // Do not block workflow movement on outbound notification failures.
  }
}

async function emitVisitCompletedEvent(payload: {
  patient_id: string
  visit_id: string
  clinic_id: string
  program_code: string
  service_type: string
  completion_time: string
}) {
  const baseUrl = process.env.AGENT_SERVICE_URL
  const token = process.env.AGENT_SERVICE_TOKEN
  if (!baseUrl || !token) return

  try {
    await fetch(`${baseUrl}/events/visit-completed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    })
  } catch {
    // Do not block workflow movement on outbound auto-scheduling failures.
  }
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
  const currentStage = flow.currentStage as ClinicalFlowStage

  if (flow.status === "active" && !canUserHandleClinicalStage(auth.context.role, currentStage, auth.context.assignedStages)) {
    const allowed = getClinicalStageAllowedRoles(currentStage).map((role) => getRoleLabel(role)).join(" or ")
    return NextResponse.json(
      { error: `Only ${allowed} with assignment to the ${currentStage} stage can move this patient.` },
      { status: 403 },
    )
  }

  try {
    const body = (await request.json()) as {
      notes?: string
      complete?: boolean
      needsNextVisit?: boolean
      nextVisit?: {
        enabled?: boolean
        providerName?: string
        appointmentType?: "routine" | "follow_up" | "urgent" | "telehealth" | "screening"
        scheduledStart?: string
        scheduledEnd?: string
        reason?: string
      }
    }

    const nextStage =
      body.complete === true || currentStage === "pharmacy"
        ? null
        : currentStage === "request"
          ? "ra"
          : currentStage === "ra"
            ? "admin"
            : currentStage === "admin"
              ? "nurse"
              : currentStage === "nurse"
                ? "doctor"
                : currentStage === "doctor"
                  ? "lab"
                  : currentStage === "lab"
                    ? "pharmacy"
                    : null
    const nextHandler = nextStage ? await findAvailableClinicianForStage(nextStage, auth.context.userId) : null

    const updated = await advanceClinicalFlow({
      flowId: id,
      actor: auth.context.name || auth.context.userId || "dashboard",
      notes: body.notes,
      complete: body.complete,
      needsNextVisit: body.needsNextVisit,
      nextHandlerUserId: nextHandler?.id,
      nextHandlerName: nextHandler?.name,
      nextHandlerRole: nextHandler?.role,
    })
    if (!updated) return NextResponse.json({ error: "Clinical flow not found" }, { status: 404 })

    await updateUserAvailability(auth.context.userId, {
      isOnDuty: true,
      availabilityStatus: "available",
    })
    if (nextHandler) {
      await updateUserAvailability(nextHandler.id, {
        isOnDuty: true,
        availabilityStatus: "busy_with_patient",
      })
    }
    await closeClinicalFlowTasksForPatient(String(updated.patientId))
    if (updated.status === "active") {
      const taskTemplate = getClinicalFlowTaskTemplate(updated.currentStage as ClinicalFlowStage)
      await createOrReuseClinicalTask({
        patientId: String(updated.patientId),
        title: taskTemplate.title,
        taskType: taskTemplate.taskType,
        priority: updated.currentStage === "doctor" || updated.currentStage === "lab" ? "high" : "medium",
        assignedUserId: nextHandler?.id,
        assignedUserName: nextHandler?.name,
        notes: taskTemplate.notes,
      })
    }

    await writeAuditLogSafe({
      entityType: "clinic_flow",
      entityId: String(updated.id),
      action: `rbac_clinical_flow_advance:${String(updated.currentStage)}:${auth.context.role}`,
      actorType: "provider",
    })

    let createdNextVisit: Record<string, unknown> | null = null
    const patient = updated.status === "completed" ? await getPatientById(String(updated.patientId)) : undefined
    if (updated.status === "completed" && updated.appointmentId) {
      await updateAppointmentStatus(String(updated.appointmentId), "completed")
    }

    if (
      updated.status === "completed" &&
      currentStage === "pharmacy" &&
      !body.nextVisit?.enabled &&
      isChronicCareCondition(patient?.conditionSummary)
    ) {
      await emitVisitCompletedEvent({
        patient_id: String(updated.patientId),
        visit_id: String(updated.appointmentId ?? updated.id),
        clinic_id: "main-clinic",
        program_code: getPatientProgramCode(patient?.conditionSummary),
        service_type: String(flow.appointmentType ?? "follow_up"),
        completion_time: new Date().toISOString(),
      })
    }

    if (updated.status === "completed" && body.nextVisit?.enabled) {
      if (!body.nextVisit.scheduledStart || !body.nextVisit.scheduledEnd) {
        return NextResponse.json({ error: "nextVisit start/end are required when enabled" }, { status: 400 })
      }
      createdNextVisit = await createAppointment({
        patientId: String(updated.patientId),
        providerName: body.nextVisit.providerName || "Clinic Provider",
        appointmentType: body.nextVisit.appointmentType || "follow_up",
        scheduledStart: body.nextVisit.scheduledStart,
        scheduledEnd: body.nextVisit.scheduledEnd,
        status: "scheduled",
        reason: body.nextVisit.reason || "Follow-up after clinical flow completion",
        enableReminderWorkflow: true,
      })
      await writeAuditLogSafe({
        entityType: "appointment",
        entityId: String(createdNextVisit.id),
        action: `rbac_followup_appointment_create:${auth.context.role}`,
        actorType: "provider",
      })
      await emitAppointmentScheduledEvent({
        patient_id: String(createdNextVisit.patientId),
        appointment_id: String(createdNextVisit.id),
        clinic_id: "main-clinic",
        appointment_type: String(createdNextVisit.appointmentType),
        provider_name: String(createdNextVisit.providerName),
        scheduled_start: String(createdNextVisit.scheduledStart),
      })
    }

    return NextResponse.json({ data: updated, nextVisit: createdNextVisit })
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
  }
}
