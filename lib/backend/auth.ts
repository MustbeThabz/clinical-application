import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"

export type UserRole = "participant" | "clinic_admin" | "clinical_staff" | "lab_pharmacy"

export type RequestContext = {
  userId: string
  role: UserRole
  email?: string
  name?: string
}

const ROLE_VALUES: UserRole[] = ["participant", "clinic_admin", "clinical_staff", "lab_pharmacy"]
const SESSION_COOKIE = "clinical_session"
const SESSION_TTL_SECONDS = 60 * 60 * 8

function isUserRole(value: string): value is UserRole {
  return ROLE_VALUES.includes(value as UserRole)
}

type SessionPayload = {
  userId: string
  role: UserRole
  email: string
  name: string
  exp: number
}

function sessionSecret() {
  return process.env.AUTH_SESSION_SECRET || "local-dev-session-secret"
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url")
}

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) return new Map<string, string>()
  const map = new Map<string, string>()
  for (const entry of cookieHeader.split(";")) {
    const [name, ...rest] = entry.trim().split("=")
    if (!name || rest.length === 0) continue
    map.set(name, decodeURIComponent(rest.join("=")))
  }
  return map
}

export function createSessionToken(input: Omit<SessionPayload, "exp">, ttlSeconds = SESSION_TTL_SECONDS) {
  const payload: SessionPayload = { ...input, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const encoded = toBase64Url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

export function getSessionFromCookieHeader(cookieHeader: string | null): RequestContext | null {
  const cookies = parseCookies(cookieHeader)
  const token = cookies.get(SESSION_COOKIE)
  if (!token) return null

  const [encodedPayload, tokenSignature] = token.split(".")
  if (!encodedPayload || !tokenSignature) return null

  const expectedSignature = sign(encodedPayload)
  const isValidSignature =
    tokenSignature.length === expectedSignature.length &&
    timingSafeEqual(Buffer.from(tokenSignature), Buffer.from(expectedSignature))

  if (!isValidSignature) return null

  try {
    const raw = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload
    if (!raw?.userId || !raw?.role || !isUserRole(raw.role) || raw.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return { userId: raw.userId, role: raw.role, email: raw.email, name: raw.name }
  } catch {
    return null
  }
}

export function getRequestContext(request: Request): RequestContext | null {
  const cookieContext = getSessionFromCookieHeader(request.headers.get("cookie"))
  if (cookieContext) {
    return cookieContext
  }

  if (process.env.ALLOW_HEADER_AUTH !== "true") {
    return null
  }

  const headerRole = request.headers.get("x-user-role")?.trim().toLowerCase()
  const role = headerRole && isUserRole(headerRole) ? headerRole : null

  if (!role) return null

  const userId = request.headers.get("x-user-id")?.trim() || "header-user"
  return { userId, role }
}

export function requireRole(request: Request, allowedRoles: UserRole[]) {
  const context = getRequestContext(request)
  if (!context) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  if (!allowedRoles.includes(context.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "Forbidden",
          requiredRoles: allowedRoles,
          currentRole: context.role,
        },
        { status: 403 },
      ),
    }
  }

  return { ok: true as const, context }
}

export function requireAuth(request: Request) {
  const context = getRequestContext(request)
  if (!context) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }
  return { ok: true as const, context }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; ${
      process.env.NODE_ENV === "production" ? "Secure; " : ""
    }`,
  )
}

export function clearSessionCookie(response: NextResponse) {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}`,
  )
}
