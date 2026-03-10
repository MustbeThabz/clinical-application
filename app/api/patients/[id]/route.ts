import { NextResponse } from "next/server"
import { getPatientById, updatePatient } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"
import { updatePatientInputSchema } from "@/lib/backend/types"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: Context) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const patient = await getPatientById(id)

  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 })
  }

  return NextResponse.json({ data: patient })
}

export async function PATCH(request: Request, context: Context) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff"])
  if (!auth.ok) return auth.response

  const { id } = await context.params

  try {
    const body = await request.json()
    const payload = updatePatientInputSchema.parse(body)
    const updated = await updatePatient(id, payload)

    if (!updated) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 })
    }

    return NextResponse.json({ data: updated })
  } catch {
    return NextResponse.json({ error: "Invalid patient update payload" }, { status: 400 })
  }
}
