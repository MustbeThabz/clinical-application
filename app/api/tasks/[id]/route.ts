import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { listAlerts, updateAlertStatus, updateClinicalTask, writeAuditLogSafe } from "@/lib/backend/db"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: Context) {
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

  const { id } = await context.params

  try {
    const body = (await request.json()) as { status?: "in_progress" | "done" | "cancelled"; notes?: string }
    if (!body.status && body.notes === undefined) {
      return NextResponse.json({ error: "status or notes is required" }, { status: 400 })
    }
    if (body.status === "done" && !body.notes?.trim()) {
      return NextResponse.json({ error: "Clinician notes are required before marking a task as done." }, { status: 400 })
    }

    const updatedTask = await updateClinicalTask(id, {
      status: body.status,
      notes: body.notes?.trim() ? body.notes.trim() : body.notes === "" ? "" : undefined,
    })
    if (!updatedTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const relatedAlertId = updatedTask.relatedAlertId ? String(updatedTask.relatedAlertId) : undefined
    if (relatedAlertId && body.status === "done") {
      const alerts = await listAlerts({ alertType: "workflow" })
      const alert = alerts.find((item) => String(item.id) === relatedAlertId)
      if (alert && String(alert.status) !== "resolved") {
        await updateAlertStatus(relatedAlertId, "resolved")
      }
    }

    await writeAuditLogSafe({
      entityType: "task",
      entityId: id,
      action: `rbac_task_${body.status ?? "notes_updated"}:${auth.context.role}`,
      actorType: "provider",
    })

    return NextResponse.json({ data: updatedTask })
  } catch {
    return NextResponse.json({ error: "Invalid task update payload" }, { status: 400 })
  }
}
