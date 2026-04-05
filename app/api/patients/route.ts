import { NextResponse } from "next/server"
import { createPatient, listPatients } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"
import { createPatientInputSchema } from "@/lib/backend/types"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, [
    "clinic_admin",
    "receptionist_admin",
    "research_assistant",
    "nurse",
    "doctor",
    "lab_personnel",
    "pharmacist",
  ])
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search") ?? undefined
  const status = searchParams.get("status") ?? undefined

  const patients = await listPatients({ search, status })
  return NextResponse.json({ data: patients, count: patients.length })
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin"])
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const payload = createPatientInputSchema.parse(body)
    const patient = await createPatient(payload)
    return NextResponse.json({ data: patient }, { status: 201 })
  } catch {
    return NextResponse.json(
      {
        error: "Invalid patient payload",
      },
      { status: 400 },
    )
  }
}
