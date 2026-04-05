import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { getClinicalFlowById, createOrReuseWorkflowAlert, writeAuditLogSafe } from "@/lib/backend/db"
import { getClinicalFlowSlaStatus, STAGE_SLA_MINUTES } from "@/lib/clinical-flow"
import type { ClinicalFlowStage } from "@/lib/backend/types"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, context: Context) {
  const auth = await requireRole(_request, [
    "clinic_admin",
    "receptionist_admin",
    "research_assistant",
    "nurse",
    "doctor",
    "lab_personnel",
    "pharmacist",
  ])
  if (!auth.ok) return auth.response

  const { id } = await context.params
  const flow = await getClinicalFlowById(id)
  if (!flow) {
    return NextResponse.json({ error: "Clinical flow not found" }, { status: 404 })
  }
  if (flow.status !== "active") {
    return NextResponse.json({ error: "Only active clinical flows can be escalated." }, { status: 400 })
  }

  const stage = flow.currentStage as ClinicalFlowStage
  const updatedAt = String(flow.updatedAt ?? "")
  const patientId = String(flow.patientId ?? "")
  const waitMinutes = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  const slaStatus = getClinicalFlowSlaStatus(stage, waitMinutes)
  if (slaStatus === "on_track") {
    return NextResponse.json({ error: "This patient has not reached the escalation threshold yet." }, { status: 400 })
  }

  const targetMinutes = STAGE_SLA_MINUTES[stage]
  const severity = waitMinutes >= targetMinutes * 2 ? "critical" : "high"
  const title = `Workflow SLA breach at ${stage}`
  const description = `${flow.patientName} has waited ${waitMinutes} minutes at the ${stage} stage. Target is ${targetMinutes} minutes.`

  const alert = await createOrReuseWorkflowAlert({
    patientId,
    title,
    description,
    severity,
  })

  await writeAuditLogSafe({
    entityType: "clinic_flow",
    entityId: id,
    action: `rbac_clinical_flow_sla_escalate:${auth.context.role}:${stage}`,
    actorType: "provider",
  })

  return NextResponse.json({ data: alert })
}
