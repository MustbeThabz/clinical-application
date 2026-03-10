import { NextResponse } from "next/server"
import { listPatientAppointments } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: Context) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const appointments = await listPatientAppointments(id)
  return NextResponse.json({ data: appointments, count: appointments.length })
}
