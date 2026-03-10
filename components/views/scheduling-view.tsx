"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Calendar, Check, CheckCircle2, Clock, MessageSquare, Phone } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type AppointmentItem = {
  id: string
  patientId: string
  patientMrn: string
  patientName: string
  providerName: string
  appointmentType: string
  scheduledStart: string
  scheduledEnd: string
  status: "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show"
  reason?: string
}

type ScheduleStats = {
  total: number
  confirmed: number
  pending: number
  notConfirmed: number
}

function getStatusBadge(status: AppointmentItem["status"]) {
  switch (status) {
    case "scheduled":
    case "checked_in":
      return (
        <Badge className="bg-success/20 text-success border-success/30">
          <Check className="w-3 h-3 mr-1" />
          Confirmed
        </Badge>
      )
    case "cancelled":
      return (
        <Badge className="bg-primary/20 text-primary border-primary/30">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      )
    default:
      return (
        <Badge className="bg-destructive/20 text-destructive border-destructive/30">
          <AlertCircle className="w-3 h-3 mr-1" />
          Not Confirmed
        </Badge>
      )
  }
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
}

function durationMin(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
}

export function SchedulingView() {
  const [date] = useState(new Date().toISOString().slice(0, 10))
  const [appointments, setAppointments] = useState<AppointmentItem[]>([])
  const [stats, setStats] = useState<ScheduleStats>({ total: 0, confirmed: 0, pending: 0, notConfirmed: 0 })

  const loadSchedule = async () => {
    const [appointmentsRes, statsRes] = await Promise.all([
      fetch(`/api/scheduling/appointments?date=${date}`, { cache: "no-store" }),
      fetch(`/api/scheduling/stats?date=${date}`, { cache: "no-store" }),
    ])

    const appointmentsData = (await appointmentsRes.json()) as { data?: AppointmentItem[] }
    const statsData = (await statsRes.json()) as { data?: ScheduleStats }

    setAppointments(appointmentsData.data ?? [])
    setStats(statsData.data ?? { total: 0, confirmed: 0, pending: 0, notConfirmed: 0 })
  }

  useEffect(() => {
    void loadSchedule()
  }, [date])

  const readableDate = useMemo(() => {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  }, [date])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Automated Scheduling</h1>
          <p className="text-muted-foreground">Live appointment operations from backend scheduling APIs</p>
        </div>
        <Button onClick={() => void loadSchedule()}>
          <Calendar className="w-4 h-4 mr-2" />
          Refresh Schedule
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.confirmed}</p>
                <p className="text-xs text-muted-foreground">Confirmed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pending}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertCircle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.notConfirmed}</p>
                <p className="text-xs text-muted-foreground">Not Confirmed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Today&apos;s Schedule</CardTitle>
          <CardDescription>{readableDate}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {appointments.map((apt) => (
            <div key={apt.id} className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors">
              <div className="text-center min-w-[60px]">
                <p className="font-semibold">{timeLabel(apt.scheduledStart)}</p>
                <p className="text-xs text-muted-foreground">{durationMin(apt.scheduledStart, apt.scheduledEnd)} min</p>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{apt.patientName}</span>
                  <span className="text-xs text-muted-foreground">{apt.patientMrn}</span>
                </div>
                <p className="text-sm text-muted-foreground">{apt.appointmentType} with {apt.providerName}</p>
              </div>
              {getStatusBadge(apt.status)}
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Phone className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MessageSquare className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
