import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { EVIL, owner, readySequence, uniq } from "./_engage-parity";

const WEEKDAYS = {
  mon: [
    ["09:00", "12:00"],
    ["13:00", "17:00"],
  ],
  wed: [["10:00", "16:00"]],
};

async function createSchedule(data: Record<string, unknown> = {}) {
  const res = await (await apiAsRole("manager")).post("/api/v1/emailer_schedules", {
    data: { name: uniq("sched"), timezone: "Europe/London", windows: WEEKDAYS, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).emailer_schedule as { id: string; isDefault: boolean };
}

test.describe("schedules (emailer_schedules)", () => {
  test("every workspace has a default business-hours schedule", async () => {
    for (const api of [await owner(), await apiAs(GLOBEX_OWNER)]) {
      const list = (await (await api.get("/api/v1/emailer_schedules")).json()).emailer_schedules;
      const defaults = list.filter((s: { isDefault: boolean }) => s.isDefault);
      expect(defaults).toHaveLength(1);
      if (defaults[0].name === "Normal business hours") {
        expect(defaults[0].windows.mon).toEqual([["08:00", "17:00"]]);
        expect(defaults[0].windows.sat).toBeUndefined();
      }
    }
  });

  test("read for every role, write per schedule:manage", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/emailer_schedules")).status(), role).toBe(expected(role, "sequence:read"));
      const created = await api.post("/api/v1/emailer_schedules", {
        data: { name: uniq(role), timezone: "UTC", windows: WEEKDAYS },
      });
      expect(created.status(), role).toBe(expected(role, "schedule:manage", 201));
      const target = await createSchedule();
      const patch = await api.patch(`/api/v1/emailer_schedules/${target.id}`, { data: { name: uniq("renamed") } });
      expect(patch.status(), role).toBe(expected(role, "schedule:manage"));
      const del = await api.delete(`/api/v1/emailer_schedules/${target.id}`);
      expect(del.status(), role).toBe(expected(role, "schedule:manage"));
    }
  });

  test("making a schedule the default moves the flag; the default can't be deleted or unset", async () => {
    const api = await apiAsRole("manager");
    const list = (await (await api.get("/api/v1/emailer_schedules")).json()).emailer_schedules;
    const oldDefault = list.find((s: { isDefault: boolean }) => s.isDefault);
    const fresh = await createSchedule();
    const made = await api.patch(`/api/v1/emailer_schedules/${fresh.id}`, { data: { isDefault: true } });
    expect((await made.json()).emailer_schedule.isDefault).toBe(true);
    const after = (await (await api.get("/api/v1/emailer_schedules")).json()).emailer_schedules;
    expect(after.filter((s: { isDefault: boolean }) => s.isDefault).map((s: { id: string }) => s.id)).toEqual([
      fresh.id,
    ]);
    expect((await api.delete(`/api/v1/emailer_schedules/${fresh.id}`)).status()).toBe(409);
    expect((await api.patch(`/api/v1/emailer_schedules/${fresh.id}`, { data: { isDefault: false } })).status()).toBe(
      422,
    );
    // Restore the previous default so other specs see the usual schedule.
    await api.patch(`/api/v1/emailer_schedules/${oldDefault.id}`, { data: { isDefault: true } });
    expect((await api.delete(`/api/v1/emailer_schedules/${fresh.id}`)).status()).toBe(200);
  });

  test("a schedule used by a sequence can't be deleted", async () => {
    const schedule = await createSchedule();
    const { id } = await readySequence(await owner(), { activate: false, extra: { scheduleId: schedule.id } });
    const api = await apiAsRole("manager");
    const res = await api.delete(`/api/v1/emailer_schedules/${schedule.id}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/sequence/i);
    const list = (await (await api.get("/api/v1/emailer_schedules")).json()).emailer_schedules;
    expect(list.find((s: { id: string }) => s.id === schedule.id).sequenceCount).toBe(1);
    await (await owner()).delete(`/api/v1/emailer_campaigns/${id}`);
    expect((await api.delete(`/api/v1/emailer_schedules/${schedule.id}`)).status()).toBe(200);
  });

  test("invalid input is 422", async () => {
    const api = await apiAsRole("manager");
    const post = async (data: Record<string, unknown>) =>
      (
        await api.post("/api/v1/emailer_schedules", {
          data: { name: uniq("bad"), timezone: "UTC", windows: WEEKDAYS, ...data },
        })
      ).status();
    expect(await post({ name: "" })).toBe(422);
    expect(await post({ timezone: "Mars/Olympus" })).toBe(422);
    expect(await post({ windows: {} })).toBe(422);
    expect(await post({ windows: { mon: [["17:00", "09:00"]] } })).toBe(422);
    expect(await post({ windows: { mon: [["9am", "5pm"]] } })).toBe(422);
    expect(await post({ windows: { funday: [["09:00", "10:00"]] } })).toBe(422);
  });

  test("401, CSRF 403 and Globex isolation 404", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/emailer_schedules")).status()).toBe(401);
    expect((await anon.post("/api/v1/emailer_schedules", { data: {} })).status()).toBe(401);
    expect((await anon.patch("/api/v1/emailer_schedules/x", { data: {} })).status()).toBe(401);
    expect((await anon.delete("/api/v1/emailer_schedules/x")).status()).toBe(401);

    const api = await owner();
    expect(
      (
        await api.post("/api/v1/emailer_schedules", {
          headers: EVIL,
          data: { name: uniq("x"), timezone: "UTC", windows: WEEKDAYS },
        })
      ).status(),
    ).toBe(403);
    const schedule = await createSchedule();
    expect(
      (await api.patch(`/api/v1/emailer_schedules/${schedule.id}`, { headers: EVIL, data: { name: "x" } })).status(),
    ).toBe(403);
    expect((await api.delete(`/api/v1/emailer_schedules/${schedule.id}`, { headers: EVIL })).status()).toBe(403);

    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.patch(`/api/v1/emailer_schedules/${schedule.id}`, { data: { name: "taken" } })).status()).toBe(
      404,
    );
    expect((await globex.delete(`/api/v1/emailer_schedules/${schedule.id}`)).status()).toBe(404);
    const theirs = (await (await globex.get("/api/v1/emailer_schedules")).json()).emailer_schedules;
    expect(theirs.some((s: { id: string }) => s.id === schedule.id)).toBe(false);
  });
});
