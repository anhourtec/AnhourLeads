import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";
import { log } from "@/server/log";

import { AiProviderError, aiProvider, getAiContext, SETUP_MESSAGE, type Source } from "./ai";
import {
  AI_PRESETS,
  type AiPreset,
  type AssistantAction,
  type AssistantReply,
  PRESET_LABELS,
  runPreset,
  workspaceFacts,
} from "./ai-presets";

/**
 * Assistant chats. A chat belongs to one person: only its owner can list, read, post to or delete
 * it (anyone else, in this workspace or another, gets 404).
 */

const NEW_CHAT_TITLE = "New chat";
const HISTORY_LIMIT = 12;

export const createChatInput = z.object({ title: z.string().trim().min(1).max(120).optional() }).strict();

export const postMessageInput = z
  .object({
    content: z.string().trim().max(4000).default(""),
    preset: z.enum(AI_PRESETS).optional(),
    useWorkspaceData: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.content.length > 0 || Boolean(v.preset), {
    message: "Write a message or pick a preset.",
    path: ["content"],
  });

export interface AiMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  preset: AiPreset | null;
  sources: Source[];
  actions: AssistantAction[];
  grounded: boolean;
  createdAt: string;
}

export interface AiChatView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function ownerOf(actor: Actor): string {
  if (!actor.userId) throw forbidden("Chats belong to a person. Use an API key created by a workspace member.");
  return actor.userId;
}

function chatView(row: typeof schema.aiChat.$inferSelect): AiChatView {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function asSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) =>
    v && typeof v === "object" && typeof (v as Source).label === "string"
      ? [{ label: (v as Source).label, url: typeof (v as Source).url === "string" ? (v as Source).url : null }]
      : [],
  );
}

function asActions(value: unknown): AssistantAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const a = v as Partial<AssistantAction> | null;
    return a && typeof a.label === "string" && typeof a.href === "string" && a.href.startsWith("/")
      ? [{ label: a.label, href: a.href }]
      : [];
  });
}

function messageView(row: typeof schema.aiMessage.$inferSelect): AiMessageView {
  const meta = row.metadata ?? {};
  const preset = typeof meta.preset === "string" && (AI_PRESETS as readonly string[]).includes(meta.preset);
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    preset: preset ? (meta.preset as AiPreset) : null,
    sources: asSources(meta.sources),
    actions: asActions(meta.actions),
    grounded: meta.grounded === true,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownChat(actor: Actor, id: string) {
  const userId = ownerOf(actor);
  const [row] = await db
    .select()
    .from(schema.aiChat)
    .where(
      and(
        eq(schema.aiChat.id, id),
        eq(schema.aiChat.organizationId, actor.organizationId),
        eq(schema.aiChat.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Chat not found.");
  return row;
}

export async function listChats(actor: Actor): Promise<AiChatView[]> {
  const userId = ownerOf(actor);
  const rows = await db
    .select()
    .from(schema.aiChat)
    .where(and(eq(schema.aiChat.organizationId, actor.organizationId), eq(schema.aiChat.userId, userId)))
    .orderBy(desc(schema.aiChat.updatedAt))
    .limit(100);
  return rows.map(chatView);
}

export async function createChat(actor: Actor, input: z.infer<typeof createChatInput>): Promise<AiChatView> {
  const userId = ownerOf(actor);
  const [row] = await db
    .insert(schema.aiChat)
    .values({ organizationId: actor.organizationId, userId, title: input.title ?? NEW_CHAT_TITLE })
    .returning();
  if (!row) throw new Error("chat insert returned nothing");
  return chatView(row);
}

export async function getChat(actor: Actor, id: string) {
  const chat = await ownChat(actor, id);
  const messages = await db
    .select()
    .from(schema.aiMessage)
    .where(eq(schema.aiMessage.chatId, chat.id))
    .orderBy(asc(schema.aiMessage.createdAt));
  return { chat: chatView(chat), messages: messages.map(messageView) };
}

export async function deleteChat(actor: Actor, id: string): Promise<{ id: string; deleted: true }> {
  const chat = await ownChat(actor, id);
  await db.delete(schema.aiChat).where(eq(schema.aiChat.id, chat.id));
  return { id: chat.id, deleted: true };
}

const GROUNDING_RULES = [
  "You are the AI assistant inside a B2B prospecting and outreach tool.",
  "Answer only from the facts given below and the conversation. If the facts needed aren't there, say plainly that",
  "the workspace doesn't have them and suggest where to find or add them. Never invent companies, people, numbers,",
  "news or quotes. When you use a numbered fact, cite it as [n]. Keep answers short and plain, in sentence case,",
  "without exclamation marks.",
].join(" ");

async function freeForm(
  actor: Actor,
  chatId: string,
  content: string,
  useWorkspaceData: boolean,
): Promise<AssistantReply> {
  const provider = aiProvider();
  if (!provider) {
    return {
      content: SETUP_MESSAGE,
      sources: [],
      actions: [{ label: "Open AI context center", href: "/dashboard/settings/ai-context" }],
      grounded: true,
    };
  }
  const context = await getAiContext(actor);
  const facts = useWorkspaceData ? await workspaceFacts(actor, content) : { text: "", sources: [] };
  const about = [
    context.companyDescription && `Our company: ${context.companyDescription}`,
    context.valueProposition && `Value proposition: ${context.valueProposition}`,
    context.targetCustomers && `Target customers: ${context.targetCustomers}`,
    context.tone && `Preferred tone: ${context.tone}`,
  ].filter(Boolean);
  const system = [
    GROUNDING_RULES,
    about.length ? `\nAbout the user's company:\n${about.join("\n")}` : "\nThe user hasn't described their company.",
    useWorkspaceData ? `\nWorkspace data:\n${facts.text}` : "\nWorkspace data is turned off for this message.",
  ].join("\n");
  const history = await db
    .select({ role: schema.aiMessage.role, content: schema.aiMessage.content })
    .from(schema.aiMessage)
    .where(eq(schema.aiMessage.chatId, chatId))
    .orderBy(desc(schema.aiMessage.createdAt))
    .limit(HISTORY_LIMIT);
  const messages = history
    .reverse()
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  try {
    const text = await provider.complete({ system, messages, maxTokens: 900 });
    return { content: text, sources: facts.sources, actions: [], grounded: useWorkspaceData };
  } catch (error) {
    if (!(error instanceof AiProviderError)) log.error("assistant reply failed", { component: "ai", error });
    return {
      content:
        error instanceof AiProviderError ? error.message : "The assistant couldn't answer right now. Try again later.",
      sources: [],
      actions: [],
      grounded: false,
    };
  }
}

export async function postMessage(actor: Actor, chatId: string, input: z.infer<typeof postMessageInput>) {
  const chat = await ownChat(actor, chatId);
  const userText = input.content || (input.preset ? PRESET_LABELS[input.preset] : "");
  const [userRow] = await db
    .insert(schema.aiMessage)
    .values({ chatId: chat.id, role: "user", content: userText, metadata: { preset: input.preset ?? null } })
    .returning();

  const reply = input.preset
    ? await runPreset(actor, input.preset, input.content)
    : await freeForm(actor, chat.id, userText, input.useWorkspaceData);

  const [assistantRow] = await db
    .insert(schema.aiMessage)
    .values({
      chatId: chat.id,
      role: "assistant",
      content: reply.content,
      metadata: {
        preset: input.preset ?? null,
        sources: reply.sources,
        actions: reply.actions,
        grounded: reply.grounded,
        useWorkspaceData: input.useWorkspaceData,
      },
    })
    .returning();
  const title = chat.title === NEW_CHAT_TITLE ? userText.replace(/\s+/g, " ").slice(0, 60) : chat.title;
  await db.update(schema.aiChat).set({ title, updatedAt: new Date() }).where(eq(schema.aiChat.id, chat.id));
  if (!userRow || !assistantRow) throw new Error("message insert returned nothing");
  return { chat: { ...chatView(chat), title }, messages: [messageView(userRow), messageView(assistantRow)] };
}
