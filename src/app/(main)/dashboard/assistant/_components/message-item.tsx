"use client";

import Link from "next/link";

import { ArrowRight, ExternalLink, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AiMessageView } from "@/server/services/ai-chats";

function SourceLink({ label, url }: { label: string; url: string | null }) {
  if (!url) return <span>{label}</span>;
  if (url.startsWith("/")) {
    return (
      <Link href={url} className="break-all text-primary underline-offset-4 hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** One message: yours on the right, the assistant's on the left with its sources and next steps. */
export function MessageItem({ message }: { message: AiMessageView }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-muted px-3 py-2 text-sm">
          {message.content}
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-card">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="sr-only">Assistant:</span>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</div>
        {message.sources.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="font-medium text-muted-foreground text-xs">Sources</h3>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-muted-foreground text-xs">
              {message.sources.map((source) => (
                <li key={`${source.label}|${source.url ?? ""}`}>
                  <SourceLink label={source.label} url={source.url} />
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {message.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <Button key={action.href + action.label} size="sm" variant="outline" asChild>
                <Link href={action.href}>
                  <ArrowRight data-icon="inline-start" aria-hidden="true" />
                  {action.label}
                </Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
