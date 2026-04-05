import { NextResponse } from "next/server"
import { createAppointment, listAppointmentsForDate, listAppointmentsForRange, writeAuditLogSafe } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

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
    // Avoid breaking scheduling flow if agent service is unavailable.
  }
}

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

  const { searchParams } = new URL(request.url)
  const start = searchParams.get("start")
  const end = searchParams.get("end")
  if (start && end) {
    const data = await listAppointmentsForRange(start, end)
    return NextResponse.json({ data, count: data.length, start, end })
  }
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  const data = await listAppointmentsForDate(date)
  return NextResponse.json({ data, count: data.length, date })
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  try {
    const body = (await request.json()) as {
      patientId: string
      providerName: string
      appointmentType: "routine" | "follow_up" | "urgent" | "telehealth" | "screening"
      scheduledStart: string
      scheduledEnd: string
      status?: "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show"
      reason?: string
      enableReminderWorkflow?: boolean
    }

    const created = await createAppointment(body)
    await writeAuditLogSafe({
      entityType: "appointment",
      entityId: String(created.id),
      action: `rbac_appointment_create:${auth.context.role}`,
      actorType: "provider",
    })
    if (created.status === "scheduled" || created.status === "checked_in") {
      await emitAppointmentScheduledEvent({
        patient_id: String(created.patientId),
        appointment_id: String(created.id),
        clinic_id: "main-clinic",
        appointment_type: String(created.appointmentType),
        provider_name: String(created.providerName),
        scheduled_start: String(created.scheduledStart),
      })
    }
    return NextResponse.json({ data: created }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Invalid appointment payload" }, { status: 400 })
  }
}
