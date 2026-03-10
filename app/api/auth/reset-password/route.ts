import { NextResponse } from "next/server"
import { resetPassword, resetPasswordInputSchema } from "@/lib/backend/users"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const payload = resetPasswordInputSchema.parse(body)
    const ok = await resetPassword(payload.token, payload.newPassword)

    if (!ok) {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Invalid reset payload" }, { status: 400 })
  }
}
