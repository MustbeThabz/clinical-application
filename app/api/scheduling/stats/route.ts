import { NextResponse } from "next/server"
import { getSchedulingStats } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const date = searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  const data = await getSchedulingStats(date)
  return NextResponse.json({ data, date })
}
