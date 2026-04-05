import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { getPatientActivityTimeline } from "@/lib/backend/db"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: Context) {
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
  const data = await getPatientActivityTimeline(id)
  return NextResponse.json({ data })
}
