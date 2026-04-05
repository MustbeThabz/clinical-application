"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Calendar, Check, CheckCircle2, Clock, MessageSquare, Phone } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

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

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function todayIso() {
  return formatLocalDate(new Date())
}

function startOfMonth(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00`)
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(dateIso: string) {
  const date = new Date(`${dateIso}T00:00:00`)
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function dateOnly(iso: string) {
  return iso.slice(0, 10)
}

function monthLabel(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  })
}

function shiftMonth(dateIso: string, offset: number) {
  const date = new Date(`${dateIso}T00:00:00`)
  const shifted = new Date(date.getFullYear(), date.getMonth() + offset, 1)
  return formatLocalDate(shifted)
}

function buildCalendarDays(dateIso: string) {
  const first = startOfMonth(dateIso)
  const monthStart = new Date(first)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay())

  const last = endOfMonth(dateIso)
  const gridEnd = new Date(last)
  gridEnd.setDate(last.getDate() + (6 - last.getDay()))

  const days: Array<{ iso: string; inMonth: boolean }> = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    days.push({
      iso: formatLocalDate(cursor),
      inMonth: cursor.getMonth() === monthStart.getMonth(),
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function SchedulingView({
  focusAppointmentId,
  focusDate,
}: {
  focusAppointmentId?: string | null
  focusDate?: string | null
}) {
  const [date, setDate] = useState(focusDate ?? todayIso())
  const [visibleMonth, setVisibleMonth] = useState((focusDate ?? todayIso()).slice(0, 10))
  const [appointments, setAppointments] = useState<AppointmentItem[]>([])
  const [stats, setStats] = useState<ScheduleStats>({ total: 0, confirmed: 0, pending: 0, notConfirmed: 0 })

  const changeVisibleMonth = (offset: number) => {
    const nextMonth = shiftMonth(visibleMonth, offset)
    setVisibleMonth(nextMonth)
    setDate(nextMonth)
  }

  const loadSchedule = async () => {
    const monthStart = formatLocalDate(startOfMonth(visibleMonth))
    const monthEnd = formatLocalDate(endOfMonth(visibleMonth))
    const [appointmentsRes, statsRes] = await Promise.all([
      fetch(`/api/scheduling/appointments?start=${monthStart}&end=${monthEnd}`, { cache: "no-store" }),
      fetch(`/api/scheduling/stats?date=${date}`, { cache: "no-store" }),
    ])

    const appointmentsData = (await appointmentsRes.json()) as { data?: AppointmentItem[] }
    const statsData = (await statsRes.json()) as { data?: ScheduleStats }

    setAppointments(appointmentsData.data ?? [])
    setStats(statsData.data ?? { total: 0, confirmed: 0, pending: 0, notConfirmed: 0 })
  }

  useEffect(() => {
    void loadSchedule()
  }, [date, visibleMonth])

  useEffect(() => {
    if (focusDate) {
      setDate(focusDate)
      setVisibleMonth(focusDate)
    }
  }, [focusDate])

  useEffect(() => {
    if (!focusAppointmentId) return
    const target = document.getElementById(`appointment-${focusAppointmentId}`)
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [focusAppointmentId, appointments])

  const readableDate = useMemo(() => {
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  }, [date])

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth])

  const appointmentsByDay = useMemo(() => {
    return appointments.reduce<Record<string, AppointmentItem[]>>((acc, appointment) => {
      const key = dateOnly(appointment.scheduledStart)
      acc[key] = acc[key] ?? []
      acc[key].push(appointment)
      return acc
    }, {})
  }, [appointments])

  const selectedDateAppointments = useMemo(() => {
    return (appointmentsByDay[date] ?? []).slice().sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  }, [appointmentsByDay, date])

  const timeSlots = useMemo(() => {
    const slots: Array<{ label: string; appointment?: AppointmentItem }> = []
    for (let hour = 8; hour <= 16; hour += 1) {
      for (const minute of [0, 30]) {
        const slotLabel = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
        const appointment = selectedDateAppointments.find((item) => timeLabel(item.scheduledStart) === slotLabel)
        slots.push({ label: slotLabel, appointment })
      }
    }
    return slots
  }, [selectedDateAppointments])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Automated Scheduling</h1>
          <p className="text-muted-foreground">Live appointment operations from backend scheduling APIs</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setVisibleMonth(event.target.value)
            }}
            className="w-[180px]"
          />
          <Button onClick={() => void loadSchedule()}>
            <Calendar className="w-4 h-4 mr-2" />
            Refresh Schedule
          </Button>
        </div>
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
                <p className="text-xs text-muted-foreground">Selected Day</p>
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

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr,1fr] gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Booking Calendar</CardTitle>
              <CardDescription>{monthLabel(visibleMonth)}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => changeVisibleMonth(-1)}>
                Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => changeVisibleMonth(1)}>
                Next
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-7 gap-2 text-xs font-medium text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                <div key={label} className="px-2">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const dayAppointments = appointmentsByDay[day.iso] ?? []
                const isSelected = day.iso === date
                return (
                  <button
                    key={day.iso}
                    type="button"
                    onClick={() => {
                      setDate(day.iso)
                      setVisibleMonth(day.iso)
                    }}
                    className={`min-h-[110px] rounded-xl border p-2 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-border hover:bg-secondary/30"
                    } ${day.inMonth ? "bg-background" : "bg-muted/30 text-muted-foreground"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{new Date(`${day.iso}T00:00:00`).getDate()}</span>
                      {dayAppointments.length > 0 ? <Badge variant="secondary">{dayAppointments.length}</Badge> : null}
                    </div>
                    <div className="mt-2 space-y-1">
                      {dayAppointments.slice(0, 2).map((appointment) => (
                        <div key={appointment.id} className="rounded-md bg-secondary/60 px-2 py-1 text-xs">
                          <div className="font-medium">{timeLabel(appointment.scheduledStart)}</div>
                          <div className="truncate text-muted-foreground">{appointment.patientName}</div>
                        </div>
                      ))}
                      {dayAppointments.length > 2 ? (
                        <div className="text-xs text-muted-foreground">+{dayAppointments.length - 2} more</div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Time Slots</CardTitle>
            <CardDescription>{readableDate}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {timeSlots.map((slot) => (
              <div
                key={slot.label}
                className={`flex items-center gap-4 rounded-lg border p-3 ${slot.appointment ? "border-primary/40 bg-primary/5" : "border-border bg-background"}`}
              >
                <div className="min-w-[56px] text-sm font-semibold">{slot.label}</div>
                <div className="flex-1">
                  {slot.appointment ? (
                    <>
                      <div className="font-medium">{slot.appointment.patientName}</div>
                      <div className="text-sm text-muted-foreground">
                        {slot.appointment.appointmentType} with {slot.appointment.providerName}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Open slot</div>
                  )}
                </div>
                {slot.appointment ? getStatusBadge(slot.appointment.status) : <Badge variant="outline">Available</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Selected Day Schedule</CardTitle>
          <CardDescription>{readableDate}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selectedDateAppointments.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No bookings for this date yet. Pick another day on the calendar or create a new appointment.
            </div>
          ) : (
            selectedDateAppointments.map((apt) => (
              <div
                key={apt.id}
                id={`appointment-${apt.id}`}
                className={`flex items-center gap-4 p-3 rounded-lg border hover:bg-secondary/30 transition-colors ${focusAppointmentId === apt.id ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
              >
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
                  <p className="text-sm text-muted-foreground">
                    {apt.appointmentType} with {apt.providerName}
                  </p>
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
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
