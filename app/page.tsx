import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ClinicalAppShell } from "@/components/clinical-app-shell"
import { getSessionFromCookieHeader } from "@/lib/backend/auth"
import { getUserById } from "@/lib/backend/users"

export default async function HomePage() {
  const cookieHeader = (await cookies()).toString()
  const session = getSessionFromCookieHeader(cookieHeader)

  if (!session) {
    redirect("/login")
  }

  const user = await getUserById(session.userId)
  if (!user) {
    redirect("/login")
  }

  return <ClinicalAppShell user={user} />
}
