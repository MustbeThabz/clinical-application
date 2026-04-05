import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { writeAuditLogSafe } from "@/lib/backend/db"
import {
  ROLE_VALUES,
  canAdvanceClinicalStage as canAdvanceClinicalStageForRole,
  getClinicalStageAllowedRoles as getClinicalStageAllowedRolesForStage,
  getRoleLabel as getRoleLabelForUser,
  type UserRole,
} from "@/lib/roles"
import { getUserByEmail, getUserById } from "@/lib/backend/users"

export type RequestContext = {
  userId: string
  role: UserRole
  email?: string
  name?: string
  assignedStages?: import("@/lib/backend/types").ClinicalFlowStage[]
}

export const STAFF_ROLE_VALUES: UserRole[] = ROLE_VALUES.filter((role) => role !== "participant")
const SESSION_COOKIE = "clinical_session"
const SESSION_TTL_SECONDS = 60 * 60 * 8

function isUserRole(value: string): value is UserRole {
  return ROLE_VALUES.includes(value as UserRole)
}

export function getRoleLabel(role: UserRole) {
  return getRoleLabelForUser(role)
}

export function canAdvanceClinicalStage(role: UserRole, stage: import("@/lib/backend/types").ClinicalFlowStage) {
  return canAdvanceClinicalStageForRole(role, stage)
}

export function getClinicalStageAllowedRoles(stage: import("@/lib/backend/types").ClinicalFlowStage) {
  return getClinicalStageAllowedRolesForStage(stage)
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

function auditRequestTarget(request: Request) {
  const url = new URL(request.url)
  return `${request.method} ${url.pathname}`
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

export async function getRequestContext(request: Request): Promise<RequestContext | null> {
  const cookieContext = getSessionFromCookieHeader(request.headers.get("cookie"))
  if (cookieContext) {
    const user = await getUserById(cookieContext.userId)
    if (!user) {
      return null
    }

    return {
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      assignedStages: user.assignedStages,
    }
  }

  if (process.env.ALLOW_HEADER_AUTH !== "true") {
    return null
  }

  if (process.env.NODE_ENV === "production") {
    return null
  }

  const headerRole = request.headers.get("x-user-role")?.trim().toLowerCase()
  if (!headerRole || !isUserRole(headerRole)) return null

  const userId = request.headers.get("x-user-id")?.trim()
  const email = request.headers.get("x-user-email")?.trim()
  const user = userId ? await getUserById(userId) : email ? await getUserByEmail(email) : undefined

  if (!user || user.role !== headerRole) {
    return null
  }

  return {
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    assignedStages: user.assignedStages,
  }
}

export async function requireRole(request: Request, allowedRoles: UserRole[]) {
  const context = await getRequestContext(request)
  if (!context) {
    await writeAuditLogSafe({
      entityType: "security",
      entityId: auditRequestTarget(request),
      action: "auth_unauthorized",
      actorType: "api_client",
    })
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  if (!allowedRoles.includes(context.role)) {
    await writeAuditLogSafe({
      entityType: "security",
      entityId: context.userId,
      action: `auth_forbidden:${context.role}:${request.method}:${new URL(request.url).pathname}`,
      actorType: "api_client",
    })
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

export async function requireAuth(request: Request) {
  const context = await getRequestContext(request)
  if (!context) {
    await writeAuditLogSafe({
      entityType: "security",
      entityId: auditRequestTarget(request),
      action: "auth_unauthorized",
      actorType: "api_client",
    })
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
