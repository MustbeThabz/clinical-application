import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { updateAlertStatus, writeAuditLogSafe } from "@/lib/backend/db"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireRole(request, ["clinic_admin", "receptionist_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const { id } = await context.params

  try {
    const body = (await request.json()) as { status?: "acknowledged" | "resolved" | "dismissed" }
    if (!body.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 })
    }

    const updated = await updateAlertStatus(id, body.status)
    if (!updated) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 })
    }

    await writeAuditLogSafe({
      entityType: "alert",
      entityId: id,
      action: `rbac_alert_${body.status}:${auth.context.role}`,
      actorType: "provider",
    })

    return NextResponse.json({ data: updated })
  } catch {
    return NextResponse.json({ error: "Invalid alert update payload" }, { status: 400 })
  }
}
