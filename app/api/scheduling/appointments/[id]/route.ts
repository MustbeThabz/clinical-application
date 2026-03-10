import { NextResponse } from "next/server"
import { getPatientById, updateAppointmentStatus } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

const STATUS_VALUES = new Set(["scheduled", "checked_in", "completed", "cancelled", "no_show"])

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
    // Avoid breaking clinical workflow if agent service is unavailable.
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff"])
  if (!auth.ok) return auth.response

  const { id } = await context.params

  try {
    const body = (await request.json()) as { status?: string }
    if (!body.status || !STATUS_VALUES.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    const updated = await updateAppointmentStatus(
      id,
      body.status as "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show",
    )

    if (!updated) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 })
    }

    if (updated.status === "completed") {
      const patient = await getPatientById(String(updated.patientId))
      await emitVisitCompletedEvent({
        patient_id: String(updated.patientId),
        visit_id: String(updated.id),
        clinic_id: "main-clinic",
        program_code: patient?.conditionSummary?.toUpperCase().replace(/\s+/g, "_") ?? "GENERAL",
        service_type: String(updated.appointmentType),
        completion_time: new Date().toISOString(),
      })
    }

    return NextResponse.json({ data: updated })
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
  }
}
