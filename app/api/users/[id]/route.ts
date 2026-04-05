import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { writeAuditLogSafe } from "@/lib/backend/db"
import { updateUser, updateUserInputSchema } from "@/lib/backend/users"

export const runtime = "nodejs"

type Context = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireRole(request, ["clinic_admin"])
  if (!auth.ok) return auth.response

  const { id } = await context.params

  try {
    const body = await request.json()
    const payload = updateUserInputSchema.parse(body)
    if (payload.isActive === false && auth.context.userId === id) {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 })
    }
    const user = await updateUser(id, payload)
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    await writeAuditLogSafe({
      entityType: "user",
      entityId: user.id,
      action: `rbac_user_update:${auth.context.role}`,
      actorType: "provider",
    })

    return NextResponse.json({ data: user })
  } catch (error) {
    if (error instanceof Error && error.message === "User already exists") {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Invalid user payload" }, { status: 400 })
  }
}
