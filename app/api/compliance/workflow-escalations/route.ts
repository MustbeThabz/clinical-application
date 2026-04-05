import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { listAlerts, listClinicalFlows } from "@/lib/backend/db"
import { listUsers } from "@/lib/backend/users"
import { getWorkflowEscalationTarget } from "@/lib/clinical-flow"
import { getRoleLabel, type UserRole } from "@/lib/roles"
import type { ClinicalFlowStage } from "@/lib/backend/types"

export const runtime = "nodejs"

const STAGE_LABELS: Record<ClinicalFlowStage, string> = {
  request: "Request Received",
  ra: "Ready for RA",
  admin: "Ready for Admin",
  nurse: "Ready for Nurse",
  doctor: "Ready for Doctor",
  lab: "Ready for Lab",
  pharmacy: "Ready for Pharmacy",
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const [alerts, flows, users] = await Promise.all([
    listAlerts({ status: "open", alertType: "workflow" }),
    listClinicalFlows(),
    listUsers(),
  ])

  const activeFlows = flows.filter((flow) => String(flow.status) === "active")

  const data = alerts.map((alert) => {
    const patientId = String(alert.patientId ?? "")
    const flow = activeFlows.find((item) => String(item.patientId) === patientId)
    const currentStage = (flow?.currentStage ?? "request") as ClinicalFlowStage
    const currentOwnerUserId = flow?.currentHandlerUserId ? String(flow.currentHandlerUserId) : undefined
    const routeTarget = getWorkflowEscalationTarget(currentStage, users, currentOwnerUserId)

    return {
      id: String(alert.id),
      flowId: flow?.id ? String(flow.id) : undefined,
      patientId,
      severity: String(alert.severity),
      title: String(alert.title),
      description: alert.description ? String(alert.description) : undefined,
      status: String(alert.status),
      triggeredAt: String(alert.triggeredAt),
      currentStage,
      currentStageLabel: STAGE_LABELS[currentStage],
      currentOwner: flow?.currentHandlerName
        ? {
            userId: currentOwnerUserId,
            name: String(flow.currentHandlerName),
            role: flow.currentHandlerRole ? getRoleLabel(String(flow.currentHandlerRole) as UserRole) : "Unassigned",
          }
        : null,
      routeTarget: routeTarget
        ? {
            userId: routeTarget.user.id,
            name: routeTarget.user.name,
            role: getRoleLabel(routeTarget.user.role),
            reason: routeTarget.reason,
          }
        : null,
      patientName: flow?.patientName ? String(flow.patientName) : undefined,
      patientMrn: flow?.patientMrn ? String(flow.patientMrn) : undefined,
    }
  })

  return NextResponse.json({ data })
}
