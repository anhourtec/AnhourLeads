"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatDistanceToNowStrict } from "date-fns";
import { Activity, Bell, BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface ActivityItem {
  id: string;
  type: string;
  summary: string;
  actorName: string | null;
  occurredAt: string;
  link: string | null;
}

type Load<T> = { state: "idle" | "loading" } | { state: "error" } | { state: "ready"; data: T };

function ago(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

/** Header bell: recent workspace activity and your notifications, with an unread count. */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("notifications");
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Load<NotificationItem[]>>({ state: "idle" });
  const [activities, setActivities] = useState<Load<ActivityItem[]>>({ state: "idle" });

  const loadNotifications = useCallback(async () => {
    setNotifications((prev) => (prev.state === "ready" ? prev : { state: "loading" }));
    try {
      const res = await fetch("/api/v1/notifications?limit=30");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { notifications: NotificationItem[]; unread: number };
      setNotifications({ state: "ready", data: body.notifications });
      setUnread(body.unread);
    } catch {
      setNotifications({ state: "error" });
    }
  }, []);

  const loadActivities = useCallback(async () => {
    setActivities((prev) => (prev.state === "ready" ? prev : { state: "loading" }));
    try {
      const res = await fetch("/api/v1/activities?limit=20");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { activities: ActivityItem[] };
      setActivities({ state: "ready", data: body.activities });
    } catch {
      setActivities({ state: "error" });
    }
  }, []);

  // The unread count on first load, and refreshed every couple of minutes.
  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 120_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return;
    void loadNotifications();
    void loadActivities();
  }, [open, loadNotifications, loadActivities]);

  async function markRead(body: { ids: string[] } | { all: true }) {
    const res = await fetch("/api/v1/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      toast.error("Couldn't mark notifications as read. Try again.");
      return;
    }
    await loadNotifications();
  }

  function openNotification(item: NotificationItem) {
    if (!item.readAt) void markRead({ ids: [item.id] });
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Activity and notifications, ${unread} unread` : "Activity and notifications"}
        >
          <Bell aria-hidden="true" />
          {unread ? (
            <span
              className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground tabular-nums"
              aria-hidden="true"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <TabsList>
              <TabsTrigger value="activities">Activities</TabsTrigger>
              <TabsTrigger value="notifications">
                Notifications
                {unread ? <span className="font-mono text-muted-foreground text-xs tabular-nums">{unread}</span> : null}
              </TabsTrigger>
            </TabsList>
            {tab === "notifications" && unread ? (
              <Button size="sm" variant="ghost" onClick={() => void markRead({ all: true })}>
                <CheckCheck data-icon="inline-start" />
                Mark all read
              </Button>
            ) : null}
          </div>
          <TabsContent value="activities" className="max-h-96 overflow-y-auto">
            <FeedState load={activities} empty="No activity in this workspace yet." emptyIcon={Activity}>
              {(items: ActivityItem[]) => (
                <ul aria-label="Recent activity" className="divide-y">
                  {items.map((a) => (
                    <li key={a.id} className="px-3 py-2.5">
                      {a.link ? (
                        <Link
                          prefetch={false}
                          href={a.link}
                          onClick={() => setOpen(false)}
                          className="text-sm hover:underline"
                        >
                          {a.summary}
                        </Link>
                      ) : (
                        <p className="text-sm">{a.summary}</p>
                      )}
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        {a.actorName ? `${a.actorName} · ` : ""}
                        <time dateTime={a.occurredAt} title={new Date(a.occurredAt).toLocaleString()}>
                          {ago(a.occurredAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </FeedState>
          </TabsContent>
          <TabsContent value="notifications" className="max-h-96 overflow-y-auto">
            <FeedState load={notifications} empty="You're all caught up." emptyIcon={BellOff}>
              {(items: NotificationItem[]) => (
                <ul aria-label="Notifications" className="divide-y">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(n)}
                        className="flex w-full gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                      >
                        <span
                          className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-primary"}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${n.readAt ? "" : "font-medium"}`}>
                            {n.title}
                            {n.readAt ? null : <span className="sr-only"> (unread)</span>}
                          </span>
                          {n.body ? (
                            <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs">{n.body}</span>
                          ) : null}
                          <time
                            dateTime={n.createdAt}
                            title={new Date(n.createdAt).toLocaleString()}
                            className="mt-0.5 block text-muted-foreground text-xs"
                          >
                            {ago(n.createdAt)}
                          </time>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </FeedState>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function FeedState<T>({
  load,
  empty,
  emptyIcon: EmptyIcon,
  children,
}: {
  readonly load: Load<T[]>;
  readonly empty: string;
  readonly emptyIcon: typeof Bell;
  readonly children: (items: T[]) => React.ReactNode;
}) {
  if (load.state === "error") {
    return (
      <p className="px-3 py-8 text-center text-muted-foreground text-sm">This couldn't load. Try again shortly.</p>
    );
  }
  if (load.state !== "ready") {
    return (
      <div className="flex flex-col gap-3 p-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  if (!load.data.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-muted-foreground text-sm">
        <EmptyIcon className="size-5" aria-hidden="true" />
        {empty}
      </div>
    );
  }
  return <>{children(load.data)}</>;
}
