import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { HttpError } from "@/server/http/errors";
import { log } from "@/server/log";
import { aiStatus } from "@/server/services/ai";
import { getChat, listChats } from "@/server/services/ai-chats";

import { ErrorState } from "../_components/pipeline/error-state";
import { AssistantWorkspace } from "./_components/assistant-workspace";

export const metadata: Metadata = { title: "AI assistant" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AssistantPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = actorFromContext(await getAppContext());
  if (!actor || !can(actor.role, "ai:use")) notFound();
  const sp = await searchParams;
  const chatId = typeof sp.chat === "string" ? sp.chat.slice(0, 128) : null;

  const loaded = await Promise.all([
    listChats(actor),
    chatId
      ? getChat(actor, chatId).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 404) return null;
          throw error;
        })
      : Promise.resolve(null),
  ]).catch((error: unknown) => {
    log.error("assistant failed to load", { component: "ai", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [chats, active] = loaded;

  return (
    <AssistantWorkspace
      key={active?.chat.id ?? "new"}
      chats={chats}
      activeChat={active?.chat ?? null}
      initialMessages={active?.messages ?? []}
      configured={aiStatus().configured}
      canEditContext={can(actor.role, "aicontext:manage")}
    />
  );
}
