"use client"

import Link from "next/link"
import { startTransition, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function LandingSignIn() {
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
    <div className="relative mt-6 overflow-hidden rounded-[2rem] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 text-white shadow-[0_26px_80px_rgba(2,12,18,0.35)] backdrop-blur-xl">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_32%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/70">Quick Access</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Sign in to your workspace</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-200/80">
              Continue into scheduling, patient tracking, alerts, and clinic operations from the hero panel.
            </p>
          </div>
          <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            Secure
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="landing-email" className="text-sm text-slate-100">
              Email
            </Label>
            <Input
              id="landing-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="h-12 rounded-2xl border-white/12 bg-white/8 px-4 text-white placeholder:text-slate-300/55 focus-visible:border-cyan-200 focus-visible:ring-cyan-200/25"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="landing-password" className="text-sm text-slate-100">
                Password
              </Label>
              <Link href="/forgot-password" className="text-xs font-medium text-cyan-100/85 transition hover:text-white">
                Forgot password?
              </Link>
            </div>
            <Input
              id="landing-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="h-12 rounded-2xl border-white/12 bg-white/8 px-4 text-white placeholder:text-slate-300/55 focus-visible:border-cyan-200 focus-visible:ring-cyan-200/25"
            />
          </div>

          {error ? <p className="text-sm text-amber-200">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-cyan-300 px-5 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(34,211,238,0.22)] transition hover:-translate-y-0.5 hover:bg-cyan-200 disabled:translate-y-0"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  )
}
