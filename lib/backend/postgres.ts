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

function dockerPsqlArgs(sql: string) {
  const composeFile = process.env.POSTGRES_DOCKER_COMPOSE_FILE || "docker-compose.agent.yml"
  const service = process.env.POSTGRES_DOCKER_SERVICE || "postgres"
  const db = process.env.POSTGRES_DOCKER_DB || "clinical_app"
  const user = process.env.POSTGRES_DOCKER_USER || "postgres"

  return ["compose", "-f", composeFile, "exec", "-T", service, "psql", "-U", user, "-d", db, "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]
}

export function postgresEnabled() {
  return process.env.BACKEND_STORE === "postgres"
}

export function sqlString(value: string | undefined | null) {
  if (value === undefined || value === null) return "NULL"
  return `'${value.replace(/'/g, "''")}'`
}

export async function runSql(sql: string) {
  const useDockerPsql = process.env.POSTGRES_PSQL_MODE === "docker"

  try {
    const { stdout } = await execFileAsync(useDockerPsql ? "docker" : "psql", useDockerPsql ? dockerPsqlArgs(sql) : psqlArgs(sql), {
      env: process.env,
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
    })
    return stdout.trim()
  } catch (error) {
    if (useDockerPsql) {
      throw error
    }

    const err = error as NodeJS.ErrnoException
    if (err.code !== "ENOENT") {
      throw error
    }

    const { stdout } = await execFileAsync("docker", dockerPsqlArgs(sql), {
      env: process.env,
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
    })
    return stdout.trim()
  }
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
