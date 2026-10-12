"use client";

import Link from "next/link";

import { BookOpen, MessageSquare, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiChatView } from "@/server/services/ai-chats";

/** Left pane: start a chat, open the context center, and your own chats. */
export function ChatList({
  chats,
  activeId,
  deleting,
  onNewChat,
  onDelete,
  onNavigate,
}: {
  chats: AiChatView[];
  activeId: string | null;
  deleting: string | null;
  onNewChat: () => void;
  onDelete: (chat: AiChatView) => void;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Assistant" className="flex min-w-0 flex-col gap-1">
      <Button
        size="sm"
        variant={activeId ? "ghost" : "secondary"}
        className="justify-start"
        onClick={() => {
          onNewChat();
          onNavigate?.();
        }}
      >
        <Plus data-icon="inline-start" aria-hidden="true" />
        Start new chat
      </Button>
      <Button size="sm" variant="ghost" className="justify-start" asChild>
        <Link href="/dashboard/settings/ai-context" onClick={onNavigate}>
          <BookOpen data-icon="inline-start" aria-hidden="true" />
          Context center
        </Link>
      </Button>

      <h2 className="mt-4 px-2 font-medium text-muted-foreground text-xs">Chats</h2>
      {chats.length === 0 ? (
        <p className="px-2 py-1 text-muted-foreground text-sm">No chats yet</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {chats.map((chat) => {
            const active = chat.id === activeId;
            return (
              <li key={chat.id} className="group flex min-w-0 items-center gap-1">
                <Link
                  href={`/dashboard/assistant?chat=${chat.id}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-muted font-medium" : ""}`}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{chat.title}</span>
                </Link>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete chat ${chat.title}`}
                  disabled={deleting === chat.id}
                  onClick={() => onDelete(chat)}
                  className="shrink-0 text-muted-foreground"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
