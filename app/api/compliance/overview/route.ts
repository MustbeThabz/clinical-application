import { NextResponse } from "next/server"
import { getComplianceOverview } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const data = await getComplianceOverview()
  return NextResponse.json({ data })
}
