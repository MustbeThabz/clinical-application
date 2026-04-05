import { NextResponse } from "next/server"
import { getDashboardOverview } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

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

  const data = await getDashboardOverview()
  return NextResponse.json({ data })
}
