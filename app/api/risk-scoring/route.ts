import { NextResponse } from "next/server"
import { listRiskPatients } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff"])
  if (!auth.ok) return auth.response

  const data = await listRiskPatients()
  return NextResponse.json({ data, count: data.length })
}
