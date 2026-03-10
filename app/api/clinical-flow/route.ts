import { NextResponse } from "next/server"
import { listClinicalFlows, listClinicalFlowStages, listPatients, startClinicalFlow } from "@/lib/backend/db"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  const [flows, patients] = await Promise.all([listClinicalFlows(), listPatients()])
  return NextResponse.json({
    data: flows,
    patients: patients.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      fullName: `${p.firstName} ${p.lastName}`,
      nextAppointment: p.nextAppointment,
    })),
    stages: listClinicalFlowStages(),
  })
}

export async function POST(request: Request) {
  const auth = requireRole(request, ["clinic_admin", "clinical_staff", "lab_pharmacy"])
  if (!auth.ok) return auth.response

  try {
    const body = (await request.json()) as {
      patientId: string
      appointmentId?: string
      entryMethod?: "scan" | "admin"
    }
    if (!body.patientId) {
      return NextResponse.json({ error: "patientId is required" }, { status: 400 })
    }

    const created = await startClinicalFlow({
      patientId: body.patientId,
      appointmentId: body.appointmentId,
      entryMethod: body.entryMethod ?? "admin",
      actor: auth.context.name || auth.context.userId || "dashboard",
    })
    return NextResponse.json({ data: created }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Invalid clinical flow payload" }, { status: 400 })
  }
}
