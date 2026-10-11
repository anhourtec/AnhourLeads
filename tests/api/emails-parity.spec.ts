import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { createContact, mailpitHeaders, mailpitWaitFor, pg, suppress } from "./_engage";
import { acmeCompanyId, createMailbox, EVIL, enroll, owner, readySequence, runNow, uniq } from "./_engage-parity";

async function compose(data: Record<string, unknown>, as = owner) {
  const api = await as();
  const res = await api.post("/api/v1/emailer_messages", { data });
  return res;
}

test.describe("emails: role matrix", () => {
  test.describe.configure({ timeout: 180_000 });
  test("search, detail, analytics for every role; compose, send and discard per sequence:launch", async () => {
    const boss = await owner();
    const mailboxId = await createMailbox(boss);
    const contact = await createContact("acme", { companyId: await acmeCompanyId() });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/emailer_messages/search?group=delivered&counts=true")).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      expect((await api.get("/api/v1/emailer_messages/analytics?days=7")).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      const draft = await boss.post("/api/v1/emailer_messages", {
        data: { mailboxId, contactId: contact, subject: uniq("detail"), body: "Hi {{first_name}}" },
      });
      const draftId = (await draft.json()).emailer_message.id as string;
      expect((await api.get(`/api/v1/emailer_messages/${draftId}`)).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      const created = await api.post("/api/v1/emailer_messages", {
        data: { mailboxId, contactId: contact, subject: uniq(`c-${role}`), body: "Hello" },
      });
      expect(created.status(), role).toBe(expected(role, "sequence:launch", 201));
      expect((await api.post(`/api/v1/emailer_messages/${draftId}/send_now`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      const another = await boss.post("/api/v1/emailer_messages", {
        data: { mailboxId, contactId: contact, subject: uniq("discard"), body: "x" },
      });
      const anotherId = (await another.json()).emailer_message.id as string;
      expect((await api.delete(`/api/v1/emailer_messages/${anotherId}`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
    }
  });

  test("401, CSRF 403 and Globex isolation 404", async () => {
    const anon = await anonymous();
    expect((await anon.post("/api/v1/emailer_messages", { data: {} })).status()).toBe(401);
    expect((await anon.get("/api/v1/emailer_messages/x")).status()).toBe(401);
    expect((await anon.delete("/api/v1/emailer_messages/x")).status()).toBe(401);
    expect((await anon.get("/api/v1/emailer_messages/analytics")).status()).toBe(401);

    const api = await owner();
    const mailboxId = await createMailbox(api);
    const contact = await createContact("acme");
    expect(
      (
        await api.post("/api/v1/emailer_messages", {
          headers: EVIL,
          data: { mailboxId, contactId: contact, subject: "x", body: "y" },
        })
      ).status(),
    ).toBe(403);
    const res = await compose({ mailboxId, contactId: contact, subject: uniq("iso"), body: "y" });
    const id = (await res.json()).emailer_message.id as string;
    expect((await api.delete(`/api/v1/emailer_messages/${id}`, { headers: EVIL })).status()).toBe(403);
    expect((await api.post(`/api/v1/emailer_messages/${id}/send_now`, { headers: EVIL })).status()).toBe(403);

    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/emailer_messages/${id}`)).status()).toBe(404);
    expect((await globex.delete(`/api/v1/emailer_messages/${id}`)).status()).toBe(404);
    expect((await globex.post(`/api/v1/emailer_messages/${id}/send_now`)).status()).toBe(404);
    // Globex can't send from an Acme mailbox or to an Acme contact.
    expect(
      (
        await globex.post("/api/v1/emailer_messages", {
          data: { mailboxId, contactId: contact, subject: "x", body: "y" },
        })
      ).status(),
    ).toBe(422);
    const theirs = await (await globex.get("/api/v1/emailer_messages/search?per_page=100")).json();
    expect(theirs.emailer_messages.some((m: { id: string }) => m.id === id)).toBe(false);
  });

  test("invalid compose input is 422", async () => {
    const api = await owner();
    const mailboxId = await createMailbox(api);
    const contact = await createContact("acme", { firstName: null });
    const post = async (data: Record<string, unknown>) =>
      (await api.post("/api/v1/emailer_messages", { data })).status();
    expect(await post({ mailboxId, subject: "x", body: "y" })).toBe(422);
    expect(await post({ mailboxId, contactId: contact, subject: "", body: "y" })).toBe(422);
    expect(await post({ mailboxId, contactId: contact, subject: "x", body: "  " })).toBe(422);
    expect(await post({ mailboxId: "nope", contactId: contact, subject: "x", body: "y" })).toBe(422);
    expect(await post({ mailboxId, toEmail: `${uniq("nobody")}@example.test`, subject: "x", body: "y" })).toBe(422);
    expect(await post({ mailboxId, contactId: contact, subject: "x", body: "y", scheduledAt: "soon" })).toBe(422);
    // A merge field the contact has no value for is refused, never sent blank.
    expect(await post({ mailboxId, contactId: contact, subject: "Hi {{first_name}}", body: "y" })).toBe(422);
  });
});

test.describe("emails: one-off composer and the emails list", () => {
  test("compose then send now delivers with sender identification and one-click unsubscribe", async () => {
    const api = await owner();
    const mailboxId = await createMailbox(api, { signature: "Sam Lee\nAcme Outbound" });
    const contact = await createContact("acme", { firstName: "Grace", companyId: await acmeCompanyId() });
    const marker = uniq("one-off");
    const res = await compose({
      mailboxId,
      contactId: contact,
      subject: `Hi {{first_name}} ${marker}`,
      body: "Quick note for {{first_name}}.",
    });
    expect(res.status(), await res.text()).toBe(201);
    const message = (await res.json()).emailer_message;
    expect(message).toMatchObject({ status: "queued", subject: `Hi Grace ${marker}`, sequence: null });
    const sent = await api.post(`/api/v1/emailer_messages/${message.id}/send_now`);
    expect(sent.status(), await sent.text()).toBe(200);
    expect((await sent.json()).emailer_message.status).toBe("sent");
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    const headers = await mailpitHeaders(mail.ID);
    expect(headers["List-Unsubscribe"]?.[0]).toMatch(/\/u\//);

    const detail = (await (await api.get(`/api/v1/emailer_messages/${message.id}`)).json()).emailer_message;
    expect(detail.body).toContain("Sam Lee");
    expect(detail.headers.map((h: { name: string }) => h.name)).toEqual(
      expect.arrayContaining(["From", "To", "Subject", "List-Unsubscribe"]),
    );
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("email_sent");

    const search = await (
      await api.get(`/api/v1/emailer_messages/search?group=delivered&mailboxId=${mailboxId}&counts=true`)
    ).json();
    expect(search.emailer_messages.map((m: { id: string }) => m.id)).toContain(message.id);
    expect(search.counts.delivered).toBeGreaterThanOrEqual(1);
    const q = await (await api.get(`/api/v1/emailer_messages/search?q=${marker}`)).json();
    expect(q.emailer_messages.map((m: { id: string }) => m.id)).toEqual([message.id]);
    expect((await api.delete(`/api/v1/emailer_messages/${message.id}`)).status()).toBe(422);
  });

  test("a scheduled one-off waits for its time; a toEmail matching a contact is accepted", async () => {
    const api = await owner();
    const mailboxId = await createMailbox(api);
    const email = `${uniq("known")}@example.test`;
    await createContact("acme", { email });
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const res = await compose({ mailboxId, toEmail: email, subject: uniq("later"), body: "Later", scheduledAt: at });
    expect(res.status(), await res.text()).toBe(201);
    const message = (await res.json()).emailer_message;
    expect(message.status).toBe("queued");
    expect(new Date(message.scheduledAt).toISOString()).toBe(at);
    const scheduled = await (
      await api.get(`/api/v1/emailer_messages/search?group=scheduled&mailboxId=${mailboxId}`)
    ).json();
    expect(scheduled.emailer_messages.map((m: { id: string }) => m.id)).toEqual([message.id]);
    expect((await api.delete(`/api/v1/emailer_messages/${message.id}`)).status()).toBe(200);
  });

  test("suppression is honoured for one-off emails", async () => {
    const api = await owner();
    const mailboxId = await createMailbox(api);
    const email = `${uniq("dnc")}@example.test`;
    const contact = await createContact("acme", { email });
    await suppress("acme", "email", email);
    const res = await compose({ mailboxId, contactId: contact, subject: uniq("blocked"), body: "x" });
    const id = (await res.json()).emailer_message.id as string;
    const sent = await api.post(`/api/v1/emailer_messages/${id}/send_now`);
    expect(sent.status()).toBe(200);
    const after = (await sent.json()).emailer_message;
    expect(after.status).toBe("blocked");
    expect(after.blockedReason).toMatch(/Suppressed/);
    const notSent = await (
      await api.get(`/api/v1/emailer_messages/search?group=not_sent&mailboxId=${mailboxId}`)
    ).json();
    expect(notSent.emailer_messages.map((m: { id: string }) => m.id)).toEqual([id]);
  });

  test("sequence emails appear with their sequence and step; analytics counts them per mailbox", async () => {
    const api = await owner();
    const { id, marker, mailboxId } = await readySequence(api);
    await enroll(api, id, [await createContact("acme", { companyId: await acmeCompanyId() })]);
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${marker}"`);
    const list = await (await api.get(`/api/v1/emailer_messages/search?sequenceId=${id}`)).json();
    expect(list.emailer_messages[0]).toMatchObject({ status: "sent", sequence: { id }, stepPosition: 1 });
    const analytics = (await (await api.get(`/api/v1/emailer_messages/analytics?days=7&mailboxId=${mailboxId}`)).json())
      .analytics;
    expect(analytics.totals).toMatchObject({ sent: 1, delivered: 1, bounced: 0 });
    expect(analytics.series).toHaveLength(7);
    expect(analytics.mailboxes).toEqual([expect.objectContaining({ id: mailboxId, sent: 1 })]);
    // One-off filter excludes sequence emails.
    const oneOff = await (await api.get(`/api/v1/emailer_messages/search?oneOff=true&mailboxId=${mailboxId}`)).json();
    expect(oneOff.emailer_messages).toHaveLength(0);
    const { rows } = await pg().query("select count(*)::int as n from outbound_message where mailbox_id = $1", [
      mailboxId,
    ]);
    expect(rows[0].n).toBe(1);
  });
});
