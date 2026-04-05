"use client"

import Link from "next/link"
import { startTransition, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("admin@clinic.local")
  const [password, setPassword] = useState("Admin123!")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? "Login failed")
        setLoading(false)
        return
      }

      startTransition(() => {
        router.push("/")
        router.refresh()
      })
    } catch {
      setError("Unable to sign in right now.")
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#04131a_0%,#08232e_58%,#0c3440_100%)] px-4 py-10 sm:px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(25,211,192,0.18),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(64,164,255,0.2),transparent_26%)]" />
      <div className="absolute left-[-7rem] top-20 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
      <div className="absolute right-[-6rem] bottom-10 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />

      <div className="relative w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] p-8 text-white shadow-[0_30px_100px_rgba(2,12,18,0.45)] backdrop-blur-xl sm:p-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_32%,transparent_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_32%)]" />

        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/70">Clinical Platform</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Sign in to your workspace</h1>
              <p className="mt-3 max-w-lg text-base leading-7 text-slate-200/80">
                Access patient operations, scheduling, workflow visibility, and clinic coordination from one secure place.
              </p>
            </div>
            <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              Secure
            </div>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-slate-100">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-12 rounded-2xl border-white/12 bg-white/8 px-4 text-white placeholder:text-slate-300/55 focus-visible:border-cyan-200 focus-visible:ring-cyan-200/25"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password" className="text-sm text-slate-100">
                  Password
                </Label>
                <Link href="/forgot-password" className="text-xs font-medium text-cyan-100/85 transition hover:text-white">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-12 rounded-2xl border-white/12 bg-white/8 px-4 text-white placeholder:text-slate-300/55 focus-visible:border-cyan-200 focus-visible:ring-cyan-200/25"
              />
            </div>

            {error ? <p className="text-sm text-amber-200">{error}</p> : null}

            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-cyan-300 px-5 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(34,211,238,0.22)] transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0"
              type="submit"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
