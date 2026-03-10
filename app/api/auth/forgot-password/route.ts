import { NextResponse } from "next/server"
import { createPasswordReset, forgotPasswordInputSchema } from "@/lib/backend/users"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const payload = forgotPasswordInputSchema.parse(body)
    const token = await createPasswordReset(payload.email)

    const base = {
      ok: true,
      message: "If the account exists, a reset instruction has been generated.",
    }

    if (process.env.NODE_ENV !== "production" && token) {
      return NextResponse.json({ ...base, resetToken: token })
    }

    return NextResponse.json(base)
  } catch {
    return NextResponse.json({ error: "Invalid email payload" }, { status: 400 })
  }
}
