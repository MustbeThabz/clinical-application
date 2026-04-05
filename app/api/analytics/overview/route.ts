import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { getAnalyticsOverview } from "@/lib/backend/db"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "research_assistant", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const overview = await getAnalyticsOverview()
  return NextResponse.json(overview)
}
