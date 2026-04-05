import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/backend/auth"
import { getUserById } from "@/lib/backend/users"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth.response

  const user = await getUserById(auth.context.userId)
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json({ data: user })
}
