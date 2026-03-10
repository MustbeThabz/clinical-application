import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { UserRole } from "@/lib/backend/auth"

type StoredUser = {
  id: string
  email: string
  name: string
  role: UserRole
  passwordHash: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type PasswordResetToken = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  usedAt?: string
  createdAt: string
}

type AuthDb = {
  users: StoredUser[]
  passwordResets: PasswordResetToken[]
}

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "auth-db.json")
const USER_ROLES: UserRole[] = ["participant", "clinic_admin", "clinical_staff", "lab_pharmacy"]

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(["participant", "clinic_admin", "clinical_staff", "lab_pharmacy"]),
  password: z.string().min(8),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(8),
})

export type PublicUser = Omit<StoredUser, "passwordHash">
export const createUserInputSchema = createUserSchema
export const forgotPasswordInputSchema = forgotPasswordSchema
export const resetPasswordInputSchema = resetPasswordSchema

const nowIso = () => new Date().toISOString()

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password: string, passwordHash: string) {
  const [algo, salt, hash] = passwordHash.split("$")
  if (algo !== "scrypt" || !salt || !hash) return false
  const computed = scryptSync(password, salt, 64).toString("hex")
  return hash.length === computed.length && timingSafeEqual(Buffer.from(hash), Buffer.from(computed))
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function toPublicUser(user: StoredUser): PublicUser {
  const { passwordHash, ...safe } = user
  return safe
}

function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole)
}

function createSeedDb(): AuthDb {
  const now = nowIso()
  const adminEmail = process.env.ADMIN_EMAIL || "admin@clinic.local"
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!"
  const adminName = process.env.ADMIN_NAME || "Clinic Admin"

  return {
    users: [
      {
        id: randomUUID(),
        email: adminEmail.toLowerCase(),
        name: adminName,
        role: "clinic_admin",
        passwordHash: hashPassword(adminPassword),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    passwordResets: [],
  }
}

let writeQueue = Promise.resolve()

async function ensureAuthDb(): Promise<AuthDb> {
  await mkdir(DATA_DIR, { recursive: true })

  try {
    const raw = await readFile(DB_PATH, "utf-8")
    const parsed = JSON.parse(raw) as AuthDb
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : [],
    }
  } catch {
    const seed = createSeedDb()
    await writeFile(DB_PATH, JSON.stringify(seed, null, 2), "utf-8")
    return seed
  }
}

async function saveAuthDb(db: AuthDb) {
  writeQueue = writeQueue.then(() => writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8"))
  await writeQueue
}

export async function listUsers(): Promise<PublicUser[]> {
  const db = await ensureAuthDb()
  return db.users.map(toPublicUser)
}

export async function getUserById(id: string): Promise<PublicUser | undefined> {
  const db = await ensureAuthDb()
  const user = db.users.find((item) => item.id === id && item.isActive)
  return user ? toPublicUser(user) : undefined
}

export async function authenticateUser(email: string, password: string): Promise<PublicUser | null> {
  const db = await ensureAuthDb()
  const user = db.users.find((item) => item.email === email.toLowerCase() && item.isActive)
  if (!user) return null
  if (!verifyPassword(password, user.passwordHash)) return null
  return toPublicUser(user)
}

export async function createUser(input: z.infer<typeof createUserSchema>): Promise<PublicUser> {
  const payload = createUserSchema.parse(input)
  if (!isUserRole(payload.role)) {
    throw new Error("Invalid role")
  }

  const db = await ensureAuthDb()
  const existing = db.users.find((item) => item.email === payload.email.toLowerCase())
  if (existing) {
    throw new Error("User already exists")
  }

  const now = nowIso()
  const user: StoredUser = {
    id: randomUUID(),
    email: payload.email.toLowerCase(),
    name: payload.name,
    role: payload.role,
    passwordHash: hashPassword(payload.password),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }

  db.users.push(user)
  await saveAuthDb(db)
  return toPublicUser(user)
}

export async function createPasswordReset(email: string): Promise<string | null> {
  const db = await ensureAuthDb()
  const user = db.users.find((item) => item.email === email.toLowerCase() && item.isActive)
  if (!user) return null

  const now = new Date()
  const token = randomBytes(24).toString("hex")
  const reset: PasswordResetToken = {
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashResetToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 1000 * 60 * 30).toISOString(),
  }

  db.passwordResets = db.passwordResets.filter((item) => {
    return item.userId !== user.id || (item.usedAt === undefined && new Date(item.expiresAt) > now)
  })
  db.passwordResets.push(reset)
  await saveAuthDb(db)
  return token
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  if (newPassword.length < 8) return false

  const db = await ensureAuthDb()
  const now = new Date()
  const tokenHash = hashResetToken(token)
  const resetItem = db.passwordResets.find(
    (item) => item.tokenHash === tokenHash && !item.usedAt && new Date(item.expiresAt) > now,
  )
  if (!resetItem) return false

  const user = db.users.find((item) => item.id === resetItem.userId && item.isActive)
  if (!user) return false

  user.passwordHash = hashPassword(newPassword)
  user.updatedAt = now.toISOString()
  resetItem.usedAt = now.toISOString()
  await saveAuthDb(db)
  return true
}
