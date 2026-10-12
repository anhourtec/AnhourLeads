"use client";

import { useState } from "react";

import Link from "next/link";

import { BriefcaseBusiness, UserRoundX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import type { JobChange } from "@/server/services/data-health";

import { Pill } from "../../_components/pipeline/pills";
import { exactTime, timeAgo } from "./format";

export function JobChangesTab({ initialChanges, canUpdate }: { initialChanges: JobChange[]; canUpdate: boolean }) {
  const [changes, setChanges] = useState(initialChanges);
  const [pending, setPending] = useState<string | null>(null);

  const mark = async (c: JobChange) => {
    setPending(c.contactId);
    const res = await apiFetch(`/api/v1/contacts/${c.contactId}`, { method: "PATCH", body: { stage: "changed_job" } });
    setPending(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setChanges((current) => current.filter((x) => x.contactId !== c.contactId));
    toast.success(`${c.name} marked as changed job.`);
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BriefcaseBusiness className="size-4 text-muted-foreground" aria-hidden="true" />
          Possible job changes
        </CardTitle>
        <CardDescription className="max-w-prose">
          People whose email started bouncing, or who are missing from their company's team page in the latest crawl. A
          missing name is only a hint: many sites list only part of their team. Check before you change a record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {changes.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No job changes spotted</EmptyTitle>
              <EmptyDescription>
                Crawl your companies' websites from Research to compare their team pages with your contacts.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Seen</TableHead>
                  {canUpdate ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.contactId}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col">
                        <Link href={`/dashboard/people/${c.contactId}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        {c.email ? <span className="font-mono text-muted-foreground text-xs">{c.email}</span> : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{c.companyName ?? "—"}</TableCell>
                    <TableCell>
                      {c.signal === "strong" ? (
                        <Pill tone="attention">Likely moved</Pill>
                      ) : (
                        <Pill tone="neutral">Hint</Pill>
                      )}
                    </TableCell>
                    <TableCell className="min-w-56 text-sm">
                      {c.reason}
                      {c.sourceUrl ? (
                        <>
                          {" "}
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-muted-foreground text-xs hover:underline"
                          >
                            Team page
                          </a>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      <time dateTime={c.detectedAt} title={exactTime(c.detectedAt)} suppressHydrationWarning>
                        {timeAgo(c.detectedAt)}
                      </time>
                    </TableCell>
                    {canUpdate ? (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending === c.contactId}
                          onClick={() => void mark(c)}
                        >
                          <UserRoundX data-icon="inline-start" aria-hidden="true" />
                          {pending === c.contactId ? "Saving…" : "Mark as changed job"}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
