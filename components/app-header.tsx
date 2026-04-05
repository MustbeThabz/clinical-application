"use client"

import { useEffect, useState } from "react"
import { Bell, Menu, Search, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { getRoleLabel } from "@/lib/roles"
import type { PublicUser } from "@/lib/backend/users"

type InboxItem = {
  id: string
  kind: "task" | "workflow" | "alert"
  title: string
  badge: string
  subtitle: string
  occurredAt: string
  patientId?: string
  taskId?: string
  alertId?: string
  isRead?: boolean
}

export function AppHeader({
  user,
  onOpenWorkflow,
  onOpenTask,
  onOpenAlert,
  onOpenNavigation,
}: {
  user: PublicUser
  onOpenWorkflow: (patientId: string) => void
  onOpenTask: (patientId: string, taskId: string) => void
  onOpenAlert: (alertId: string) => void
  onOpenNavigation?: () => void
}) {
  const router = useRouter()
  const [items, setItems] = useState<InboxItem[]>([])
  const [filter, setFilter] = useState<"all" | "task" | "workflow" | "alert">("all")

  const loadInbox = async () => {
    try {
      const response = await fetch("/api/activity/inbox", { cache: "no-store" })
      const raw = await response.text()
      const result = raw ? (JSON.parse(raw) as { data?: InboxItem[] }) : {}

      if (!response.ok) {
        setItems([])
        return
      }

      setItems((result.data ?? []) as InboxItem[])
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    void loadInbox()
  }, [])

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  const markRead = async (itemId: string) => {
    await fetch("/api/activity/inbox/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    })
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, isRead: true } : item)))
  }

  const markVisibleAsRead = async () => {
    const unreadVisibleIds = filteredItems.filter((item) => !item.isRead).map((item) => item.id)
    if (unreadVisibleIds.length === 0) {
      return
    }
    await fetch("/api/activity/inbox/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true, itemIds: unreadVisibleIds }),
    })
    setItems((current) =>
      current.map((item) => (unreadVisibleIds.includes(item.id) ? { ...item, isRead: true } : item)),
    )
  }

  const unreadCount = items.filter((item) => !item.isRead).length
  const filteredItems = items.filter((item) => filter === "all" || item.kind === filter)
  const unreadVisibleCount = filteredItems.filter((item) => !item.isRead).length

  return (
    <header className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
      <div className="flex w-full items-center gap-3 sm:flex-1">
        <Button variant="ghost" size="icon" className="shrink-0 sm:hidden" onClick={onOpenNavigation}>
          <Menu className="w-5 h-5" />
        </Button>
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search patients, workflows, or actions..."
            className="pl-10 bg-secondary/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                  {Math.min(unreadCount, 9)}
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Activity Inbox</span>
              <div className="flex items-center gap-3">
                <button className="text-xs text-muted-foreground" onClick={() => void loadInbox()}>
                  Refresh
                </button>
                <button className="text-xs text-muted-foreground disabled:opacity-50" disabled={unreadVisibleCount === 0} onClick={() => void markVisibleAsRead()}>
                  Mark all read
                </button>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-2 py-1.5">
              {(["all", "task", "workflow", "alert"] as const).map((value) => (
                <button
                  key={value}
                  className={`rounded-md px-2 py-1 text-xs ${filter === value ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? "All" : value === "task" ? "Tasks" : value === "workflow" ? "Workflows" : "Alerts"}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            {filteredItems.length === 0 ? <DropdownMenuItem className="text-sm text-muted-foreground">No activity in this filter.</DropdownMenuItem> : null}
            {filteredItems.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className={`flex flex-col items-start gap-1 py-3 ${item.isRead ? "opacity-70" : ""}`}
                onClick={async () => {
                  await markRead(item.id)
                  if (item.kind === "workflow" && item.patientId) onOpenWorkflow(item.patientId)
                  if (item.kind === "task" && item.patientId && item.taskId) onOpenTask(item.patientId, item.taskId)
                  if (item.kind === "alert" && item.alertId) onOpenAlert(item.alertId)
                }}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={item.kind === "alert" || item.badge === "critical" || item.badge === "high" ? "destructive" : item.kind === "task" ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0 uppercase"
                  >
                    {item.badge}
                  </Badge>
                  {!item.isRead ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  <span className="text-xs text-muted-foreground">{new Date(item.occurredAt).toLocaleString()}</span>
                </div>
                <span className="text-sm">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.subtitle}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <User className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{getRoleLabel(user.role)}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuItem>Audit Log</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>Sign Out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
