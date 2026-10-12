import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";

/**
 * AI assistant and AI context center. The dev server runs without AI_PROVIDER, so free-form
 * questions answer with the setup message and the presets answer deterministically from workspace data.
 */

const EVIL = { origin: "https://evil.example" };
const uniq = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Message {
  role: string;
  content: string;
  preset: string | null;
  sources: { label: string; url: string | null }[];
  actions: { label: string; href: string }[];
}

async function newChat(api: APIRequestContext): Promise<string> {
  const res = await api.post("/api/v1/ai/chats", { data: {} });
  expect(res.status()).toBe(201);
  return (await res.json()).chat.id as string;
}

async function ask(api: APIRequestContext, chatId: string, data: Record<string, unknown>): Promise<Message> {
  const res = await api.post(`/api/v1/ai/chats/${chatId}/messages`, { data });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.messages).toHaveLength(2);
  expect(body.messages[0].role).toBe("user");
  return body.messages[1] as Message;
}

test.describe.configure({ timeout: 120_000 });

let originalContext: Record<string, string | null> | null = null;

test.beforeAll(async () => {
  const admin = await apiAsRole("admin");
  const res = await admin.get("/api/v1/ai/context");
  const { context } = await res.json();
  originalContext = {
    companyDescription: context.companyDescription,
    valueProposition: context.valueProposition,
    targetCustomers: context.targetCustomers,
    tone: context.tone,
  };
});

test.afterAll(async () => {
  if (!originalContext) return;
  const admin = await apiAsRole("admin");
  await admin.put("/api/v1/ai/context", { data: originalContext });
});

test.describe("ai: permissions per role", () => {
  for (const role of ROLES) {
    test(`${role}: chats, status and context follow the matrix`, async () => {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/ai/chats")).status()).toBe(expected(role, "ai:use"));
      expect((await api.get("/api/v1/ai/status")).status()).toBe(expected(role, "ai:use"));
      expect((await api.get("/api/v1/ai/context")).status()).toBe(expected(role, "ai:use"));

      const created = await api.post("/api/v1/ai/chats", { data: { title: "Role check" } });
      expect(created.status()).toBe(expected(role, "ai:use", 201));

      const current = originalContext ?? {};
      const put = await api.put("/api/v1/ai/context", { data: current });
      expect(put.status()).toBe(expected(role, "aicontext:manage"));

      if (created.status() === 201) {
        const id = (await created.json()).chat.id as string;
        expect((await api.get(`/api/v1/ai/chats/${id}`)).status()).toBe(200);
        const msg = await api.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "Hello" } });
        expect(msg.status()).toBe(201);
        expect((await api.delete(`/api/v1/ai/chats/${id}`)).status()).toBe(200);
        expect((await api.get(`/api/v1/ai/chats/${id}`)).status()).toBe(404);
      } else {
        // Viewers can't post to a chat either, even with a real id.
        const member = await apiAsRole("member");
        const id = await newChat(member);
        expect((await api.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "Hi" } })).status()).toBe(403);
        expect((await api.delete(`/api/v1/ai/chats/${id}`)).status()).toBe(403);
        await member.delete(`/api/v1/ai/chats/${id}`);
      }
    });
  }

  test("signed out: every endpoint answers 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/ai/chats")).status()).toBe(401);
    expect((await anon.post("/api/v1/ai/chats", { data: {} })).status()).toBe(401);
    expect((await anon.get("/api/v1/ai/chats/x")).status()).toBe(401);
    expect((await anon.delete("/api/v1/ai/chats/x")).status()).toBe(401);
    expect((await anon.post("/api/v1/ai/chats/x/messages", { data: { content: "Hi" } })).status()).toBe(401);
    expect((await anon.get("/api/v1/ai/context")).status()).toBe(401);
    expect((await anon.put("/api/v1/ai/context", { data: {} })).status()).toBe(401);
    expect((await anon.get("/api/v1/ai/status")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused (CSRF)", async () => {
    const member = await apiAsRole("member");
    const admin = await apiAsRole("admin");
    const id = await newChat(member);
    expect((await member.post("/api/v1/ai/chats", { data: {}, headers: EVIL })).status()).toBe(403);
    expect(
      (await member.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "Hi" }, headers: EVIL })).status(),
    ).toBe(403);
    expect((await member.delete(`/api/v1/ai/chats/${id}`, { headers: EVIL })).status()).toBe(403);
    expect((await admin.put("/api/v1/ai/context", { data: {}, headers: EVIL })).status()).toBe(403);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });
});

test.describe("ai: privacy and validation", () => {
  test("chats are private to the person who started them", async () => {
    const member = await apiAsRole("member");
    const id = await newChat(member);
    await ask(member, id, { preset: "analytics" });

    for (const other of [await apiAsRole("manager"), await apiAsRole("owner"), await apiAs(GLOBEX_OWNER)]) {
      expect((await other.get(`/api/v1/ai/chats/${id}`)).status()).toBe(404);
      expect((await other.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "Hi" } })).status()).toBe(404);
      expect((await other.delete(`/api/v1/ai/chats/${id}`)).status()).toBe(404);
      const list = await (await other.get("/api/v1/ai/chats")).json();
      expect(list.chats.some((c: { id: string }) => c.id === id)).toBe(false);
    }
    const mine = await (await member.get("/api/v1/ai/chats")).json();
    expect(mine.chats.some((c: { id: string }) => c.id === id)).toBe(true);
    expect((await member.delete(`/api/v1/ai/chats/${id}`)).status()).toBe(200);
  });

  test("invalid input answers 422 with a plain message", async () => {
    const member = await apiAsRole("member");
    const admin = await apiAsRole("admin");
    const id = await newChat(member);
    const empty = await member.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "   " } });
    expect(empty.status()).toBe(422);
    expect((await empty.json()).details[0].message).toBe("Write a message or pick a preset.");
    expect(
      (await member.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "Hi", preset: "magic" } })).status(),
    ).toBe(422);
    expect(
      (await member.post(`/api/v1/ai/chats/${id}/messages`, { data: { content: "x".repeat(4001) } })).status(),
    ).toBe(422);
    expect((await member.post("/api/v1/ai/chats", { data: { title: "" } })).status()).toBe(422);
    expect((await admin.put("/api/v1/ai/context", { data: { tone: "x".repeat(501) } })).status()).toBe(422);
    expect((await admin.put("/api/v1/ai/context", { data: { unknown: "x" } })).status()).toBe(422);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });
});

test.describe("ai: answers without a provider", () => {
  test("status says not configured and free-form questions get the setup message", async () => {
    const member = await apiAsRole("member");
    const status = await (await member.get("/api/v1/ai/status")).json();
    expect(status.status).toEqual({ configured: false, provider: "none", model: null });

    const id = await newChat(member);
    const reply = await ask(member, id, { content: "Which accounts should I call today?" });
    expect(reply.role).toBe("assistant");
    expect(reply.content).toContain("The AI assistant isn't set up");
    for (const v of ["AI_PROVIDER", "AI_API_KEY", "AI_MODEL"]) expect(reply.content).toContain(v);

    // The first message names the chat; both messages are stored.
    const detail = await (await member.get(`/api/v1/ai/chats/${id}`)).json();
    expect(detail.chat.title).toBe("Which accounts should I call today?");
    expect(detail.messages.map((m: Message) => m.role)).toEqual(["user", "assistant"]);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });

  test("context saved by an admin is readable by a member and grounds the sequence draft", async () => {
    const admin = await apiAsRole("admin");
    const member = await apiAsRole("member");
    const empty = { companyDescription: null, valueProposition: null, targetCustomers: null, tone: null };
    expect((await admin.put("/api/v1/ai/context", { data: empty })).status()).toBe(200);

    const id = await newChat(member);
    const noContext = await ask(member, id, { preset: "sequencing" });
    expect(noContext.content).toContain("The AI context center is empty");
    expect(noContext.actions[0]?.href).toBe("/dashboard/settings/ai-context");

    const context = {
      companyDescription: "We build route planning software for field service teams.",
      valueProposition: "Dispatchers plan a full day of visits in minutes. Fewer missed appointments.",
      targetCustomers: "Directors and VPs of operations at HVAC companies.",
      tone: "Plain and brief.",
    };
    const saved = await admin.put("/api/v1/ai/context", { data: context });
    expect(saved.status()).toBe(200);
    const read = await (await member.get("/api/v1/ai/context")).json();
    expect(read.context).toMatchObject(context);

    const draft = await ask(member, id, { preset: "sequencing" });
    for (const step of ["Step 1", "Step 2", "Step 3"]) expect(draft.content).toContain(step);
    expect(draft.content).toContain("Dispatchers plan a full day of visits in minutes.");
    expect(draft.content).toContain("{{first_name}}");
    expect(draft.content).not.toContain("Fewer missed appointments");
    expect(draft.sources.some((s) => s.url === "/dashboard/settings/ai-context")).toBe(true);
    expect(draft.actions[0]?.href).toBe("/dashboard/sequences");

    // Prospecting builds a people search from personas or the target customers.
    const audience = await ask(member, id, { preset: "prospecting" });
    expect(audience.actions[0]?.href).toMatch(/^\/dashboard\/people\?/);
    expect(audience.actions[0]?.href).toMatch(/seniority=|title=/);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });

  test("analytics summarises the last 30 days with numbers", async () => {
    const member = await apiAsRole("member");
    const id = await newChat(member);
    const reply = await ask(member, id, { preset: "analytics" });
    expect(reply.content).toContain("Last 30 days");
    expect(reply.content).toMatch(/Emails sent: \d/);
    expect(reply.content).toMatch(/Tasks completed: \d/);
    expect(reply.content).toMatch(/Deals won: \d/);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });

  test("account briefs cite sources and say when facts aren't available", async () => {
    const member = await apiAsRole("member");
    const id = await newChat(member);

    const unknown = await ask(member, id, { preset: "research", content: "Account brief for zz-no-such-company-qq" });
    expect(unknown.content).toContain("couldn't match a company");
    expect(unknown.sources).toEqual([]);

    const bareName = uniq("Briefless");
    const bare = await member.post("/api/v1/accounts", { data: { name: bareName } });
    expect(bare.status()).toBe(201);
    const bareId = (await bare.json()).account.id as string;
    const empty = await ask(member, id, { preset: "research", content: `Account brief for ${bareName}` });
    expect(empty.content).toContain(`There aren't enough facts about ${bareName}`);
    expect(empty.actions.some((a) => a.href === "/dashboard/research")).toBe(true);

    const richName = uniq("Briefed");
    const rich = await member.post("/api/v1/accounts", {
      data: { name: richName, industry: "Logistics", employeeCount: 120, foundedYear: 2011 },
    });
    expect(rich.status()).toBe(201);
    const richId = (await rich.json()).account.id as string;
    const brief = await ask(member, id, { preset: "research", content: `Account brief for ${richName}` });
    expect(brief.content).toContain(`Account brief: ${richName}`);
    expect(brief.content).toMatch(/Industry: Logistics \[\d+\]/);
    expect(brief.content).toMatch(/Employees: 120 \[\d+\]/);
    expect(brief.content).toContain("Not available in this workspace");
    expect(brief.sources.length).toBeGreaterThan(0);
    for (const s of brief.sources) expect(s.url).toBeTruthy();

    // Another workspace's company is never found.
    const globex = await apiAs(GLOBEX_OWNER);
    const gid = await newChat(globex);
    const leak = await ask(globex, gid, { preset: "research", content: `Account brief for ${richName}` });
    expect(leak.content).toContain("couldn't match a company");
    await globex.delete(`/api/v1/ai/chats/${gid}`);

    const manager = await apiAsRole("manager");
    await manager.delete(`/api/v1/accounts/${bareId}`);
    await manager.delete(`/api/v1/accounts/${richId}`);
    await member.delete(`/api/v1/ai/chats/${id}`);
  });
});
