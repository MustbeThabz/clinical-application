import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { listClinicalTasks } from "@/lib/backend/db"

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
  const assignedUserId = searchParams.get("assignedUserId")
  const patientId = searchParams.get("patientId")
  const taskId = searchParams.get("taskId")
  const data = await listClinicalTasks({
    status: status === "open" || status === "in_progress" || status === "done" || status === "cancelled" ? status : undefined,
    assignedUserId: assignedUserId || undefined,
    patientId: patientId || undefined,
    taskId: taskId || undefined,
  })
  return NextResponse.json({ data })
}
