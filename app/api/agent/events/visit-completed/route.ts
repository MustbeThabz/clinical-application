import { NextResponse } from "next/server"
import { requireRole } from "@/lib/backend/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await requireRole(request, ["clinic_admin", "nurse", "doctor"])
  if (!auth.ok) return auth.response

  const baseUrl = process.env.AGENT_SERVICE_URL
  const token = process.env.AGENT_SERVICE_TOKEN

  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "Agent service is not configured. Set AGENT_SERVICE_URL and AGENT_SERVICE_TOKEN." },
      { status: 500 },
    )
  }

  try {
    const body = await request.json()
    const response = await fetch(`${baseUrl}/events/visit-completed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": token,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch {
    return NextResponse.json({ error: "Failed to reach agent service" }, { status: 502 })
  }
}
