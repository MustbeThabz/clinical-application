import { NextResponse } from "next/server"
import { recalculateRiskScores } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff"])
  if (!auth.ok) return auth.response

  const result = await recalculateRiskScores()
  return NextResponse.json({ data: result })
}
