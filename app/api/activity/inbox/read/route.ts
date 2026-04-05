import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/backend/auth"
import { markActivityItemRead, markActivityItemsRead } from "@/lib/backend/db"

export const runtime = "nodejs"

export async function PATCH(request: Request) {
  const auth = await requireAuth(request)
  if (!auth.ok) return auth.response

  try {
    const body = (await request.json()) as { itemId?: string; itemIds?: string[]; markAll?: boolean }
    if (body.markAll) {
      const data = await markActivityItemsRead(auth.context.userId, body.itemIds ?? [])
      return NextResponse.json({ data })
    }
    if (!body.itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 })
    }

    const data = await markActivityItemRead(auth.context.userId, body.itemId)
    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: "Invalid inbox read payload" }, { status: 400 })
  }
}
