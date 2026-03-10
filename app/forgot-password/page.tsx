"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setResetToken(null)

    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })

    const payload = (await response.json()) as { message?: string; error?: string; resetToken?: string }
    if (!response.ok) {
      setMessage(payload.error ?? "Could not submit request")
      return
    }

    setMessage(payload.message ?? "If the account exists, reset instructions were generated.")
    setResetToken(payload.resetToken ?? null)
  }

  return (
    <main className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
      <Card className="w-full max-w-md border-0 shadow-md">
        <CardHeader>
          <CardTitle>Forgot Password</CardTitle>
          <CardDescription>Enter your email to request a password reset token.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button className="w-full" type="submit">
              Request Reset
            </Button>
          </form>

          {message ? <p className="text-sm mt-4">{message}</p> : null}
          {resetToken ? (
            <p className="text-xs mt-2 text-muted-foreground">
              Dev token: {resetToken}. Use it on the <Link href="/reset-password" className="underline">reset page</Link>.
            </p>
          ) : null}

          <p className="text-sm mt-4 text-center">
            <Link href="/login" className="underline underline-offset-4">
              Back to login
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
