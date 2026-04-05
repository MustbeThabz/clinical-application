import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"
import { writeAuditLogSafe } from "@/lib/backend/db"
import { createUser, createUserInputSchema, listUsers } from "@/lib/backend/users"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireRole(request, ["clinic_admin"])
  if (!auth.ok) return auth.response

  const users = await listUsers()
  return NextResponse.json({ data: users, count: users.length })
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin"])
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const payload = createUserInputSchema.parse(body)
    const user = await createUser(payload)
    await writeAuditLogSafe({
      entityType: "user",
      entityId: user.id,
      action: `rbac_user_create:${auth.context.role}`,
      actorType: "provider",
    })
    return NextResponse.json({ data: user }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === "User already exists") {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Invalid user payload" }, { status: 400 })
  }
}
