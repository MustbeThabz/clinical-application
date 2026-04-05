import { NextResponse } from "next/server"
import { getRiskScoringOverview, listRiskPatients } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "research_assistant", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const [data, overview] = await Promise.all([listRiskPatients(), getRiskScoringOverview()])
  return NextResponse.json({ data, count: data.length, overview })
}
