"use client";

import { useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { BarChart3, Building2, Database, ListOrdered, PanelLeft, Send, Sparkles, Target, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { apiFetch } from "@/lib/api-fetch";
import type { AiChatView, AiMessageView } from "@/server/services/ai-chats";
import type { AiPreset } from "@/server/services/ai-presets";

import { ChatList } from "./chat-list";
import { MessageItem } from "./message-item";

const PRESETS: Array<{ id: AiPreset; label: string; group: string; icon: typeof Target }> = [
  { id: "prospecting", label: "Build your target audience", group: "Prospecting", icon: Target },
  { id: "research", label: "Write an account brief", group: "Research", icon: Building2 },
  { id: "sequencing", label: "Draft a 3-step sequence", group: "Sequencing", icon: ListOrdered },
  { id: "analytics", label: "Summarise the last 30 days", group: "Analytics", icon: BarChart3 },
];

interface PostResult {
  chat: AiChatView;
  messages: AiMessageView[];
}

export function AssistantWorkspace({
  chats: initialChats,
  activeChat,
  initialMessages,
  configured,
  canEditContext,
}: {
  chats: AiChatView[];
  activeChat: AiChatView | null;
  initialMessages: AiMessageView[];
  configured: boolean;
  canEditContext: boolean;
}) {
  const router = useRouter();
  const [chats, setChats] = useState(initialChats);
  const [chatId, setChatId] = useState<string | null>(activeChat?.id ?? null);
  const [messages, setMessages] = useState(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState<AiPreset | null>(null);
  const [useWorkspaceData, setUseWorkspaceData] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(content: string, chosen: AiPreset | null) {
    if (pending) return;
    if (!content.trim() && !chosen) {
      setError("Write a message or pick a preset.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    let id = chatId;
    if (!id) {
      const created = await apiFetch<{ chat: AiChatView }>("/api/v1/ai/chats", { body: {} });
      if (!created.ok) {
        setPending(false);
        setError(created.error);
        return;
      }
      id = created.data.chat.id;
      setChatId(id);
      setChats((list) => [created.data.chat, ...list]);
    }
    const res = await apiFetch<PostResult>(`/api/v1/ai/chats/${id}/messages`, {
      body: { content: content.trim(), ...(chosen ? { preset: chosen } : {}), useWorkspaceData },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessages((list) => [...list, ...res.data.messages]);
    setChats((list) => [res.data.chat, ...list.filter((c) => c.id !== res.data.chat.id)]);
    setPrompt("");
    setPreset(null);
    window.history.replaceState(null, "", `/dashboard/assistant?chat=${id}`);
  }

  function runPreset(id: AiPreset) {
    if (id === "research" && !prompt.trim()) {
      setPreset("research");
      setPrompt("Account brief for ");
      setError(null);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
      return;
    }
    void send(prompt, id);
  }

  function newChat() {
    setChatId(null);
    setMessages([]);
    setPrompt("");
    setPreset(null);
    setError(null);
    window.history.replaceState(null, "", "/dashboard/assistant");
  }

  async function deleteChat(chat: AiChatView) {
    setDeleting(chat.id);
    const res = await apiFetch(`/api/v1/ai/chats/${chat.id}`, { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setChats((list) => list.filter((c) => c.id !== chat.id));
    toast.success("Chat deleted.");
    if (chat.id === chatId) {
      newChat();
      router.refresh();
    }
  }

  const selected = PRESETS.find((p) => p.id === preset) ?? null;
  const list = (
    <ChatList
      chats={chats}
      activeId={chatId}
      deleting={deleting}
      onNewChat={newChat}
      onDelete={deleteChat}
      onNavigate={() => setPaneOpen(false)}
    />
  );

  const promptBox = (
    <form
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/40"
      onSubmit={(e) => {
        e.preventDefault();
        void send(prompt, preset);
      }}
    >
      {selected ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Preset:</span>
          <span className="font-medium">{selected.label}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Clear preset"
            onClick={() => {
              setPreset(null);
              setPrompt("");
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <label htmlFor="assistant-prompt" className="sr-only">
        Message the AI assistant
      </label>
      <Textarea
        id="assistant-prompt"
        ref={inputRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send(prompt, preset);
          }
        }}
        placeholder={
          selected?.id === "research"
            ? "Name the company or give its domain"
            : "Ask about your accounts, lists or results"
        }
        maxLength={4000}
        rows={2}
        className="min-h-14 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle size="sm" variant="outline" pressed={useWorkspaceData} onPressedChange={setUseWorkspaceData}>
          <Database aria-hidden="true" />
          Workspace data: {useWorkspaceData ? "on" : "off"}
        </Toggle>
        <Button type="submit" size="sm" disabled={pending}>
          <Send data-icon="inline-start" aria-hidden="true" />
          {pending ? "Thinking…" : "Send"}
        </Button>
      </div>
    </form>
  );

  const presets = (
    <div className="flex flex-col items-center gap-2">
      <h2 className="text-muted-foreground text-xs">Start with a preset</h2>
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => runPreset(p.id)}
            title={p.group}
          >
            <p.icon data-icon="inline-start" aria-hidden="true" />
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
      <aside className="hidden min-w-0 border-r pr-4 lg:block">{list}</aside>

      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="assistant-title">
        <div className="flex items-center justify-between gap-2">
          <h1 id="assistant-title" className="font-medium text-2xl tracking-tight">
            AI assistant
          </h1>
          <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setPaneOpen(true)}>
            <PanelLeft data-icon="inline-start" aria-hidden="true" />
            Chats
          </Button>
        </div>

        {!configured ? (
          <Alert>
            <Sparkles aria-hidden="true" />
            <AlertTitle>AI isn't set up in this installation</AlertTitle>
            <AlertDescription>
              Free-form questions need an AI provider: an administrator sets AI_PROVIDER, AI_API_KEY and AI_MODEL on the
              server. The presets work without it and only use what your workspace holds.
            </AlertDescription>
          </Alert>
        ) : null}

        {messages.length === 0 ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 pt-4 md:pt-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-10 items-center justify-center rounded-lg border bg-card">
                <Sparkles className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
              <p className="font-medium text-xl tracking-tight">What would you like to work on?</p>
              <p className="max-w-prose text-muted-foreground text-sm">
                Answers only use facts your workspace holds, with a link to where each one came from. When something
                isn't known, the assistant says so.
              </p>
              {!canEditContext ? null : (
                <p className="text-muted-foreground text-xs">
                  Tip: describe what you sell in the context center to ground drafts and audiences.
                </p>
              )}
            </div>
            <div className="w-full">{promptBox}</div>
            {presets}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <ol className="flex flex-col gap-5" aria-label="Conversation" aria-live="polite">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} />
              ))}
            </ol>
            <div ref={endRef} />
            {promptBox}
            {presets}
          </div>
        )}
        {error ? (
          <p role="alert" className="mx-auto w-full max-w-2xl text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </section>

      <Sheet open={paneOpen} onOpenChange={setPaneOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>Chats</SheetTitle>
            <SheetDescription className="sr-only">Start a chat or open one of yours.</SheetDescription>
          </SheetHeader>
          <div className="px-4">{list}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
