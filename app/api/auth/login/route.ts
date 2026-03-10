import { NextResponse } from "next/server"
import { z } from "zod"
import { createSessionToken, setSessionCookie } from "@/lib/backend/auth"
import { authenticateUser } from "@/lib/backend/users"

export const runtime = "nodejs"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const payload = loginSchema.parse(body)
    const user = await authenticateUser(payload.email, payload.password)

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    const token = createSessionToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    })

    const response = NextResponse.json({ data: user })
    setSessionCookie(response, token)
    return response
  } catch {
    return NextResponse.json({ error: "Invalid login payload" }, { status: 400 })
  }
}
