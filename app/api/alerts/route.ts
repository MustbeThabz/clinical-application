import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { listAlerts } from "@/lib/backend/db"

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

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const alertType = searchParams.get("alertType")

  const data = await listAlerts({
    status: status === "open" || status === "acknowledged" || status === "resolved" || status === "dismissed" ? status : undefined,
    alertType:
      alertType === "critical_lab" ||
      alertType === "missed_appointment" ||
      alertType === "medication_nonadherence" ||
      alertType === "vital_anomaly" ||
      alertType === "workflow"
        ? alertType
        : undefined,
  })

  return NextResponse.json({ data })
}
