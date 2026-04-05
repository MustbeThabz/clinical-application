import Link from "next/link"
import { cookies } from "next/headers"
import { ClinicalAppShell } from "@/components/clinical-app-shell"
import { LandingSignIn } from "@/components/landing-sign-in"
import { getSessionFromCookieHeader } from "@/lib/backend/auth"
import { getUserById } from "@/lib/backend/users"

const features = [
  {
    title: "Smart Appointment Scheduling",
    description:
      "Book, manage, and automatically generate the next visit for research participants and chronic care patients.",
  },
  {
    title: "Journey Tracking",
    description:
      "Follow each patient from arrival through RA review, nursing, clinician consults, pharmacy, and reimbursement.",
  },
  {
    title: "Missed Visit Recovery",
    description:
      "Flag missed appointments and medication pickups early so teams can intervene before patients disengage.",
  },
  {
    title: "Shared Staff Visibility",
    description:
      "Give reception, research, nursing, pharmacy, and admin teams one operational picture of the clinic day.",
  },
  {
    title: "Patient Messaging",
    description:
      "Send reminders, confirmations, queue updates, and care instructions through SMS and app-based workflows.",
  },
  {
    title: "Operational Insights",
    description:
      "Turn clinic activity into useful dashboards that surface delays, follow-up risks, and missed care patterns.",
  },
] as const

const workflow = [
  "Patient is booked or scheduled into program flow",
  "Automatic reminder and prep instructions are sent",
  "Staff track live progress through every care stage",
  "The next appointment is created before checkout",
  "Missed visits trigger follow-up and outreach tasks",
] as const

const metrics = [
  { label: "Patient flow", value: "Live visibility" },
  { label: "Follow-up risk", value: "Early alerts" },
  { label: "Team handoffs", value: "One workspace" },
  { label: "Continuity", value: "Always tracked" },
] as const

const stages = [
  { stage: "Reception Check-In", count: "18 patients", status: "Active" },
  { stage: "RA Review", count: "11 patients", status: "In Progress" },
  { stage: "Nurse Consultation", count: "7 patients", status: "Queue" },
  { stage: "Doctor Review", count: "5 patients", status: "Pending" },
  { stage: "Pharmacy Collection", count: "9 patients", status: "Ready" },
] as const

const audiences = [
  "Clinical research sites",
  "Primary healthcare clinics",
  "Reception and admin teams",
  "Research assistants",
  "Nurses and doctors",
  "Pharmacy teams",
  "Outreach coordinators",
  "Chronic care programs",
] as const

export default async function HomePage() {
  const cookieHeader = (await cookies()).toString()
  const session = getSessionFromCookieHeader(cookieHeader)

  if (session) {
    const user = await getUserById(session.userId)
    if (user) {
      return <ClinicalAppShell user={user} />
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#04131a_0%,#071d28_42%,#f4f7f4_42%,#f4f7f4_100%)] text-slate-950">
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(25,211,192,0.22),transparent_28%),radial-gradient(circle_at_85%_15%,rgba(64,164,255,0.2),transparent_24%),linear-gradient(135deg,rgba(4,19,26,0.96),rgba(8,36,44,0.9))]" />
        <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
        <div className="absolute left-[-8rem] top-24 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="absolute right-[-7rem] top-12 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-6 pb-20 pt-8 lg:px-8 lg:pb-28 lg:pt-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-white">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold tracking-[0.2em]">
                CA
              </div>
              <div>
                <p className="text-sm font-semibold tracking-[0.28em] text-cyan-100 uppercase">Clinical Application</p>
                <p className="text-sm text-white/60">Research and chronic care operations</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="#features"
                className="hidden rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/25 hover:bg-white/8 hover:text-white md:inline-flex"
              >
                Explore
              </Link>
              <Link
                href="/login"
                className="inline-flex rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-50"
              >
                Sign In
              </Link>
            </div>
          </header>

          <div className="mt-16 grid items-center gap-16 lg:grid-cols-[1.04fr_0.96fr]">
            <div className="max-w-3xl text-white">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-white/8 px-4 py-2 text-sm font-medium text-cyan-100 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                Built for clinical research and chronic care teams
              </div>

              <h1 className="mt-7 max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl lg:text-7xl">
                Schedule smarter, track every visit, and re-engage patients before care is missed.
              </h1>

              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200/88 sm:text-xl">
                A clinic operations platform designed for South African care settings where queues are long, follow-up matters,
                and every missed visit can affect outcomes.
              </p>

              <div className="mt-9 flex flex-wrap gap-4">
                <Link
                  href="/login"
                  className="inline-flex rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(52,211,153,0.2)] transition hover:-translate-y-0.5 hover:bg-cyan-200"
                >
                  Request Demo
                </Link>
                <Link
                  href="#workflow"
                  className="inline-flex rounded-full border border-white/12 bg-white/7 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/12"
                >
                  View Features
                </Link>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-3xl border border-white/10 bg-white/7 px-5 py-4 backdrop-blur-sm"
                  >
                    <p className="text-lg font-semibold text-white">{metric.value}</p>
                    <p className="mt-1 text-sm text-slate-300">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative lg:pl-6">
              <div className="absolute -left-6 top-14 h-36 w-36 rounded-full bg-emerald-300/12 blur-3xl" />
              <div className="absolute -right-4 -top-2 h-40 w-40 rounded-full bg-cyan-200/12 blur-3xl" />

              <div className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-[#081a22]/92 p-6 text-white shadow-[0_30px_100px_rgba(2,12,18,0.55)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_30%,transparent_100%)]" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
                    <div>
                      <p className="text-sm text-white/55">Clinic Operations Dashboard</p>
                      <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Today&apos;s Care Journey</h2>
                    </div>
                    <div className="rounded-full border border-emerald-300/18 bg-emerald-300/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-100">
                      Live
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-cyan-300/12 bg-white/6 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-white/45">Checked In</p>
                      <p className="mt-2 text-2xl font-semibold">18</p>
                    </div>
                    <div className="rounded-2xl border border-cyan-300/12 bg-white/6 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-white/45">In Queue</p>
                      <p className="mt-2 text-2xl font-semibold">12</p>
                    </div>
                    <div className="rounded-2xl border border-cyan-300/12 bg-white/6 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-white/45">Alerts</p>
                      <p className="mt-2 text-2xl font-semibold text-amber-200">14</p>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    {stages.map((item) => (
                      <div
                        key={item.stage}
                        className="flex items-center justify-between rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-1 h-2.5 w-2.5 rounded-full bg-cyan-200" />
                          <div>
                            <p className="font-medium text-white">{item.stage}</p>
                            <p className="text-sm text-white/55">{item.count}</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
                    <div className="rounded-[1.4rem] border border-amber-200/18 bg-amber-200/10 p-4">
                      <p className="text-sm font-semibold text-amber-100">Follow-up Alert</p>
                      <p className="mt-1 text-sm leading-6 text-slate-100/88">
                        Fourteen patients missed appointments this week and have already been moved into outreach review.
                      </p>
                    </div>
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 px-5 py-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-white/45">Rebooked</p>
                      <p className="mt-2 text-3xl font-semibold text-emerald-100">73%</p>
                    </div>
                  </div>
                </div>
              </div>

              <LandingSignIn />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-700">Why this platform matters</p>
            <h2 className="mt-4 max-w-xl text-4xl font-semibold tracking-[-0.04em] text-slate-950">
              Designed for real clinic pressure, not idealized patient journeys.
            </h2>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-slate-600">
            The experience is built around overloaded waiting rooms, fragmented coordination, chronic disease follow-up,
            and the operational reality of keeping patients connected to care.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature, index) => (
            <article
              key={feature.title}
              className="group rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_16px_50px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 hover:shadow-[0_22px_70px_rgba(8,145,178,0.16)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#0f766e,#22d3ee)] text-lg font-semibold text-white">
                0{index + 1}
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-950">{feature.title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="border-y border-slate-200 bg-[#edf5f2]">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">Workflow visibility</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-slate-950">
              From booking to next-visit scheduling, every handoff stays visible.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
              Staff can see where patients are, what delays need attention, and which cases require outreach after a missed
              visit or medication collection.
            </p>

            <div className="mt-10 space-y-5">
              {workflow.map((step, index) => (
                <div key={step} className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-cyan-100">
                    {index + 1}
                  </div>
                  <div className="pt-2 text-base text-slate-700">{step}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">Who it serves</p>
                <h3 className="mt-2 text-2xl font-semibold text-slate-950">Built for the whole clinic team</h3>
              </div>
              <div className="hidden rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100 sm:block">
                Multi-role
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {audiences.map((item) => (
                <div
                  key={item}
                  className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="overflow-hidden rounded-[2.25rem] bg-[linear-gradient(135deg,#09202b,#0d3944_52%,#145b57)] p-8 text-white shadow-[0_28px_90px_rgba(6,24,31,0.24)] lg:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">Built for impact</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-balance">
                Reduce missed care, improve patient flow, and protect continuity across every visit.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200/85">
                The product story is clinical, operational, and human all at once, so the page now presents the platform as a
                trustworthy system for both frontline teams and program leadership.
              </p>
            </div>

            <div className="flex flex-col gap-4 lg:items-end">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-50 lg:w-auto"
              >
                Get Started
              </Link>
              <a
                href="mailto:hello@clinicalapp.local"
                className="inline-flex w-full items-center justify-center rounded-full border border-white/15 bg-white/8 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/12 lg:w-auto"
              >
                Contact Team
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
