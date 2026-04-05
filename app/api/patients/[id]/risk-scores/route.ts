import { NextResponse } from "next/server"
import { listPatientRiskScores } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: Context) {
  const auth = await requireRole(request, ["clinic_admin", "research_assistant", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const scores = await listPatientRiskScores(id)
  return NextResponse.json({ data: scores, count: scores.length })
}
