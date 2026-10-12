import "server-only";

import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
  DEFAULT_SCHEDULE_NAME,
  DEFAULT_SCHEDULE_WINDOWS,
  type ScheduleWindows,
  WEEKDAYS,
  type Weekday,
} from "@/lib/engage-constants";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { conflict, HttpError, notFound } from "@/server/http/errors";

import { audit } from "./audit";
import { isTimeZone } from "./mailboxes";

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM.");
const range = z
  .tuple([hhmm, hhmm])
  .refine(([a, b]) => a < b, { message: "The end time must be after the start time." });
const windowsSchema = z
  .object(
    Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(range).max(4).optional()])) as Record<
      Weekday,
      z.ZodOptional<z.ZodArray<typeof range>>
    >,
  )
  .strict()
  .refine((w) => Object.values(w).some((r) => r && r.length > 0), {
    message: "Add at least one sending window.",
  });

const timezone = z.string().trim().min(1).max(64).refine(isTimeZone, "Use an IANA time zone such as Europe/London.");

export const createScheduleSchema = z
  .object({
    name: z.string().trim().min(1, "Name the schedule.").max(120),
    timezone: timezone.default("UTC"),
    windows: windowsSchema,
    isDefault: z.boolean().default(false),
  })
  .strict();

export const updateScheduleSchema = z
  .object({
    name: z.string().trim().min(1, "Name the schedule.").max(120),
    timezone,
    windows: windowsSchema,
    isDefault: z.boolean(),
  })
  .partial()
  .strict();

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

type ScheduleRow = typeof schema.sendingSchedule.$inferSelect;

export interface ScheduleView {
  id: string;
  name: string;
  timezone: string;
  windows: ScheduleWindows;
  isDefault: boolean;
  sequenceCount: number;
  createdAt: string;
}

function toView(row: ScheduleRow, sequenceCount: number): ScheduleView {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    windows: row.windows as ScheduleWindows,
    isDefault: row.isDefault,
    sequenceCount,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Create the workspace's default schedule the first time anyone asks for schedules. */
async function ensureDefault(organizationId: string): Promise<void> {
  const [existing] = await db
    .select({ n: count() })
    .from(schema.sendingSchedule)
    .where(eq(schema.sendingSchedule.organizationId, organizationId));
  if ((existing?.n ?? 0) > 0) return;
  await db.insert(schema.sendingSchedule).values({
    organizationId,
    name: DEFAULT_SCHEDULE_NAME,
    timezone: "UTC",
    windows: DEFAULT_SCHEDULE_WINDOWS as Record<string, [string, string][]>,
    isDefault: true,
  });
}

export async function listSchedules(actor: Pick<Actor, "organizationId">): Promise<ScheduleView[]> {
  await ensureDefault(actor.organizationId);
  const rows = await db
    .select()
    .from(schema.sendingSchedule)
    .where(eq(schema.sendingSchedule.organizationId, actor.organizationId))
    .orderBy(asc(schema.sendingSchedule.createdAt), asc(schema.sendingSchedule.id));
  const usage = await db
    .select({ scheduleId: schema.sequence.scheduleId, n: count() })
    .from(schema.sequence)
    .where(eq(schema.sequence.organizationId, actor.organizationId))
    .groupBy(schema.sequence.scheduleId);
  const used = new Map(usage.map((u) => [u.scheduleId ?? "", u.n]));
  return rows.map((r) => toView(r, used.get(r.id) ?? 0));
}

export async function findSchedule(actor: Pick<Actor, "organizationId">, id: string): Promise<ScheduleRow> {
  const [row] = await db
    .select()
    .from(schema.sendingSchedule)
    .where(and(eq(schema.sendingSchedule.id, id), eq(schema.sendingSchedule.organizationId, actor.organizationId)))
    .limit(1);
  if (!row) throw notFound("Schedule not found.");
  return row;
}

async function getView(actor: Actor, id: string): Promise<ScheduleView> {
  const view = (await listSchedules(actor)).find((s) => s.id === id);
  if (!view) throw notFound("Schedule not found.");
  return view;
}

async function clearOtherDefaults(organizationId: string, keepId: string) {
  await db
    .update(schema.sendingSchedule)
    .set({ isDefault: false })
    .where(and(eq(schema.sendingSchedule.organizationId, organizationId), ne(schema.sendingSchedule.id, keepId)));
}

export async function createSchedule(actor: Actor, input: unknown): Promise<ScheduleView> {
  const data = createScheduleSchema.parse(input);
  await ensureDefault(actor.organizationId);
  const [row] = await db
    .insert(schema.sendingSchedule)
    .values({
      organizationId: actor.organizationId,
      name: data.name,
      timezone: data.timezone,
      windows: data.windows as Record<string, [string, string][]>,
      isDefault: data.isDefault,
    })
    .returning();
  if (data.isDefault) await clearOtherDefaults(actor.organizationId, row.id);
  await audit(actor, "schedule.create", "sending_schedule", row.id, { name: data.name });
  return getView(actor, row.id);
}

export async function updateSchedule(actor: Actor, id: string, input: unknown): Promise<ScheduleView> {
  const row = await findSchedule(actor, id);
  const data = updateScheduleSchema.parse(input);
  if (data.isDefault === false && row.isDefault) {
    throw new HttpError(422, "Make another schedule the default instead.", [
      { path: "isDefault", message: "A workspace always has one default schedule." },
    ]);
  }
  if (Object.keys(data).length) {
    await db
      .update(schema.sendingSchedule)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.windows !== undefined && { windows: data.windows as Record<string, [string, string][]> }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      })
      .where(eq(schema.sendingSchedule.id, row.id));
    if (data.isDefault) await clearOtherDefaults(actor.organizationId, row.id);
    await audit(actor, "schedule.update", "sending_schedule", row.id, { fields: Object.keys(data) });
  }
  return getView(actor, row.id);
}

export async function deleteSchedule(actor: Actor, id: string): Promise<void> {
  const row = await findSchedule(actor, id);
  if (row.isDefault) throw conflict("The default schedule can't be deleted. Make another one the default first.");
  const [used] = await db
    .select({ n: count() })
    .from(schema.sequence)
    .where(and(eq(schema.sequence.organizationId, actor.organizationId), eq(schema.sequence.scheduleId, row.id)));
  if ((used?.n ?? 0) > 0) {
    throw conflict(`${used.n} sequence${used.n === 1 ? " uses" : "s use"} this schedule. Move them to another first.`);
  }
  await db.delete(schema.sendingSchedule).where(eq(schema.sendingSchedule.id, row.id));
  await audit(actor, "schedule.delete", "sending_schedule", row.id, { name: row.name });
}

/* -------------------------------------------------------------------------- */
/* Window checks                                                              */
/* -------------------------------------------------------------------------- */

const DAY_INDEX: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/** True when `now` falls inside one of the schedule's windows, in the schedule's time zone. */
export function inSchedule(schedule: Pick<ScheduleRow, "timezone" | "windows">, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = DAY_INDEX[parts.find((p) => p.type === "weekday")?.value ?? ""];
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const ranges = (schedule.windows as ScheduleWindows)[weekday] ?? [];
  return ranges.some(([from, to]) => clock >= from && clock <= to);
}
