import { NextResponse } from "next/server"
import { advanceClinicalFlow, createAppointment, updateAppointmentStatus } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

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

export async function PATCH(request: Request, context: Context) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  const { id } = await context.params

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

    const updated = await advanceClinicalFlow({
      flowId: id,
      actor: auth.context.name || auth.context.userId || "dashboard",
      notes: body.notes,
      complete: body.complete,
      needsNextVisit: body.needsNextVisit,
    })
    if (!updated) {
      return NextResponse.json({ error: "Clinical flow not found" }, { status: 404 })
    }

    let createdNextVisit: Record<string, unknown> | null = null
    if (updated.status === "completed" && updated.appointmentId) {
      await updateAppointmentStatus(String(updated.appointmentId), "completed")
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
