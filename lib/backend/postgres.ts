import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function psqlArgs(sql: string) {
  const common = ["-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]

  if (process.env.DATABASE_URL) {
    return [process.env.DATABASE_URL, ...common]
  }

  const args = [...common]

  if (process.env.DB_HOST) args.unshift(process.env.DB_HOST), args.unshift("-h")
  if (process.env.DB_USER) args.unshift(process.env.DB_USER), args.unshift("-U")
  if (process.env.DB_NAME) args.unshift(process.env.DB_NAME), args.unshift("-d")

  return args
}

export function postgresEnabled() {
  return process.env.BACKEND_STORE === "postgres"
}

export function sqlString(value: string | undefined | null) {
  if (value === undefined || value === null) return "NULL"
  return `'${value.replace(/'/g, "''")}'`
}

export async function runSql(sql: string) {
  const { stdout } = await execFileAsync("psql", psqlArgs(sql), {
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  })
  return stdout.trim()
}

export async function runSqlJson<T>(sql: string, defaultValue: T): Promise<T> {
  try {
    const wrapped = `SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json) FROM (${sql}) q;`
    const out = await runSql(wrapped)
    return (JSON.parse(out || "[]") as T) ?? defaultValue
  } catch {
    return defaultValue
  }
}
