import { NextResponse } from "next/server"
import { recalculateRiskScores, writeAuditLogSafe } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "research_assistant", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const result = await recalculateRiskScores()
  await writeAuditLogSafe({
    entityType: "risk_scores",
    entityId: "all",
    action: `rbac_risk_recalculate:${auth.context.role}`,
    actorType: "provider",
  })
  return NextResponse.json({ data: result })
}
