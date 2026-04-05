import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/backend/auth"
import { listActivityReads, listAlerts, listClinicalFlows, listClinicalTasks } from "@/lib/backend/db"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth.response

  const tasks = await listClinicalTasks({ assignedUserId: auth.context.userId })
  const taskItems = tasks
    .filter((task) => task.status === "open" || task.status === "in_progress")
    .map((task) => ({
      id: `task:${String(task.id)}`,
      kind: "task",
      title: task.title,
      badge: task.priority,
      subtitle: task.notes ? String(task.notes) : `Assigned to ${task.assignedUserName ?? auth.context.name ?? "clinician"}`,
      occurredAt: String(task.updatedAt ?? task.createdAt),
      patientId: String(task.patientId),
      taskId: String(task.id),
    }))

  const flows = await listClinicalFlows()
  const flowItems = flows
    .filter(
      (flow) =>
        String(flow.status) === "active" &&
        flow.currentHandlerUserId &&
        String(flow.currentHandlerUserId) === auth.context.userId,
    )
    .map((flow) => ({
      id: `workflow:${String(flow.id)}`,
      kind: "workflow",
      title: `Patient waiting at ${String(flow.currentStage)}`,
      badge: String(flow.currentStage),
      subtitle: `${String(flow.patientName)} (${String(flow.patientMrn)}) is assigned to you`,
      occurredAt: String(flow.updatedAt),
      patientId: String(flow.patientId),
    }))

  let alertItems: Array<{
    id: string
    kind: string
    title: string
    badge: string
    subtitle: string
    occurredAt: string
    alertId: string
    patientId: string
  }> = []

  if (auth.context.role === "clinic_admin" || auth.context.role === "doctor" || auth.context.role === "nurse") {
    const alerts = await listAlerts({ status: "open", alertType: "workflow" })
    alertItems = alerts.map((alert) => ({
      id: `alert:${String(alert.id)}`,
      kind: "alert",
      title: String(alert.title),
      badge: String(alert.severity),
      subtitle: alert.description ? String(alert.description) : "Workflow escalation needs review",
      occurredAt: String(alert.triggeredAt),
      alertId: String(alert.id),
      patientId: String(alert.patientId),
    }))
  }

  const reads = await listActivityReads(auth.context.userId)
  const readIds = new Set(reads.map((item) => String(item.itemId)))

  const items = [...taskItems, ...flowItems, ...alertItems]
    .map((item) => ({
      ...item,
      isRead: readIds.has(item.id),
    }))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 8)

  return NextResponse.json({ data: items })
}
