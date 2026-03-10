import { NextResponse } from "next/server"

export const runtime = "nodejs"

function getAgentWebhookUrl(request: Request) {
  const base = process.env.AGENT_SERVICE_URL
  if (!base) return null
  const url = new URL(request.url)
  const target = new URL(`${base.replace(/\/$/, "")}/webhook/whatsapp`)
  target.search = url.search
  return target
}

export async function GET(request: Request) {
  const target = getAgentWebhookUrl(request)
  if (!target) {
    return NextResponse.json({ error: "AGENT_SERVICE_URL is not configured" }, { status: 500 })
  }

  try {
    const upstream = await fetch(target, {
      method: "GET",
      cache: "no-store",
    })

    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    })
  } catch {
    return NextResponse.json({ error: "Failed to reach agent webhook" }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const target = getAgentWebhookUrl(request)
  if (!target) {
    return NextResponse.json({ error: "AGENT_SERVICE_URL is not configured" }, { status: 500 })
  }

  try {
    const raw = await request.text()
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") ?? "application/json",
      },
      body: raw,
      cache: "no-store",
    })

    const body = await upstream.text()
    const contentType = upstream.headers.get("content-type") ?? "application/json"
    return new NextResponse(body, { status: upstream.status, headers: { "content-type": contentType } })
  } catch {
    return NextResponse.json({ error: "Failed to forward webhook" }, { status: 502 })
  }
}
