"use client";

import { useEffect, useState } from "react";

import { BookmarkPlus, ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/lib/format-display";
import type { getIndexCompany, IndexPersonView } from "@/server/services/discovery";

import { apiRequest } from "../api-client";
import type { IndexActions } from "./index-actions";
import { hostOf, IndexEmailCell, type IndexPermissions, SavedLink, seniorityLabel } from "./index-results";
import { CompanyTile } from "./results-table";

type IndexCompanyDetail = Awaited<ReturnType<typeof getIndexCompany>>;

const muted = <span className="text-muted-foreground">—</span>;

function When({ at, prefix }: { at: string | null; prefix?: string }) {
  if (!at) return muted;
  return (
    <time dateTime={at} title={new Date(at).toLocaleString("en-US")} suppressHydrationWarning>
      {prefix ? `${prefix} ` : null}
      {relativeTime(at)}
    </time>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  // Crawled values are untrusted: only plain web links become anchors.
  if (!/^https?:\/\//i.test(href)) return <span className="break-all">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function SaveAction({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" disabled={busy} onClick={onClick}>
      {busy ? (
        <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
      ) : (
        <BookmarkPlus data-icon="inline-start" aria-hidden="true" />
      )}
      {busy ? "Saving…" : label}
    </Button>
  );
}

/** A person from the shared index: details, where they were found, Save and Access email. */
export function IndexPersonSheet({
  person,
  onClose,
  onOpenCompany,
  actions,
  permissions,
}: {
  person: IndexPersonView | null;
  onClose: () => void;
  onOpenCompany: (id: string) => void;
  actions: IndexActions;
  permissions: IndexPermissions;
}) {
  const savedId = person ? (person.savedContactId ?? actions.savedNow[person.id] ?? null) : null;
  return (
    <Sheet open={Boolean(person)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-lg">
        {person ? (
          <>
            <SheetHeader className="border-b pr-12">
              <SheetTitle className="font-heading font-normal text-xl">{person.name}</SheetTitle>
              <SheetDescription>{person.title ?? "No title listed"}</SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {savedId ? (
                  <SavedLink href={`/dashboard/people/${savedId}`} label="Saved · open record" />
                ) : permissions.savePerson ? (
                  <SaveAction
                    label="Save person"
                    busy={actions.busy.has(person.id)}
                    onClick={() => void actions.save("contact", [person.id])}
                  />
                ) : null}
                {person.goneAt ? (
                  <Badge variant="secondary" className="bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400">
                    No longer listed
                  </Badge>
                ) : null}
              </div>
            </SheetHeader>
            <div className="flex flex-col gap-5 p-4">
              <section aria-label="Email" className="flex flex-col gap-1.5">
                <h3 className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">Email</h3>
                <div>
                  <IndexEmailCell person={person} actions={actions} canAccess={permissions.accessEmail} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {person.emailAvailable
                    ? "The company published an address for this person. Access email saves them and verifies it."
                    : "Access email saves this person and looks for their address using the company's email pattern."}
                </p>
              </section>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Fact label="Company">
                  <button
                    type="button"
                    onClick={() => onOpenCompany(person.company.id)}
                    className="flex max-w-full items-center gap-2 rounded-md text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CompanyTile name={person.company.name ?? person.company.domain} />
                    <span className="truncate">{person.company.name ?? person.company.domain}</span>
                  </button>
                </Fact>
                <Fact label="Domain">
                  <span className="font-mono text-xs">{person.company.domain}</span>
                </Fact>
                <Fact label="Management level">{seniorityLabel(person.seniority) ?? muted}</Fact>
                <Fact label="Department">{person.department ?? muted}</Fact>
                <Fact label="Location">
                  {[person.company.city, person.company.country].filter(Boolean).join(", ") || muted}
                </Fact>
                <Fact label="Industry">{person.company.industry ?? muted}</Fact>
              </dl>
              <section aria-label="Source" className="flex flex-col gap-1.5">
                <h3 className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">Source</h3>
                <ExternalA href={person.sourceUrl}>{hostOf(person.sourceUrl) ?? person.sourceUrl}</ExternalA>
                <p className="text-muted-foreground text-xs">
                  Public page · first seen <When at={person.firstSeenAt} /> · last seen <When at={person.lastSeenAt} />
                </p>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** A company from the shared index: details, its people, job postings, news and sources, with Save. */
export function IndexCompanySheet({
  companyId,
  onClose,
  actions,
  permissions,
}: {
  companyId: string | null;
  onClose: () => void;
  actions: IndexActions;
  permissions: IndexPermissions;
}) {
  const [data, setData] = useState<IndexCompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setData(null);
    setError(null);
    void apiRequest<IndexCompanyDetail>(`/api/v1/index/companies/${encodeURIComponent(companyId)}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) setError(res.error);
      else setData(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const c = data?.company;
  const name = c ? (c.name ?? c.domain) : "Company";
  const savedId = c ? (c.savedCompanyId ?? actions.savedNow[c.id] ?? null) : null;
  const current = data?.people.filter((p) => !p.goneAt) ?? [];

  return (
    <Sheet open={Boolean(companyId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="sr-only">{`Company: ${name}`}</SheetTitle>
          <SheetDescription className="sr-only">
            Company from the shared database, with its people, job postings and news.
          </SheetDescription>
          {c ? (
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <CompanyTile name={name} className="size-9 text-sm" />
                <div className="flex min-w-0 flex-col">
                  <h2 className="truncate font-heading text-xl">{name}</h2>
                  <p className="truncate text-muted-foreground text-sm">
                    {[c.industry, [c.city, c.region, c.country].filter(Boolean).join(", ")]
                      .filter(Boolean)
                      .join(" · ") || c.domain}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {savedId ? (
                  <SavedLink href={`/dashboard/companies/${savedId}`} label="Saved · open record" />
                ) : permissions.saveCompany ? (
                  <SaveAction
                    label="Save company"
                    busy={actions.busy.has(c.id)}
                    onClick={() => void actions.save("company", [c.id])}
                  />
                ) : null}
                {c.hiring ? (
                  <Badge variant="secondary" className="bg-sky-500/10 font-medium text-sky-700 dark:text-sky-400">
                    Hiring
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : !data || !c ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <span className="sr-only">Loading company</span>
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <>
              {c.description ? <p className="max-w-prose text-sm">{c.description}</p> : null}
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Fact label="Website">
                  <ExternalA href={c.websiteUrl ?? `https://${c.domain}`}>{c.domain}</ExternalA>
                </Fact>
                <Fact label="Employees">
                  {c.employeeCount !== null ? (
                    <span className="font-mono tabular-nums">{c.employeeCount.toLocaleString("en-US")}</span>
                  ) : (
                    (c.employeeRange ?? muted)
                  )}
                </Fact>
                <Fact label="Founded">
                  {c.foundedYear ? <span className="font-mono tabular-nums">{c.foundedYear}</span> : muted}
                </Fact>
                <Fact label="Phone">{c.phone ? <span className="font-mono text-xs">{c.phone}</span> : muted}</Fact>
                <Fact label="Email format">
                  {c.emailPattern ? <span className="font-mono text-xs">{c.emailPattern}</span> : muted}
                </Fact>
                <Fact label="Last crawled">
                  <When at={c.lastCrawledAt} />
                </Fact>
              </dl>
              {c.keywords.length || c.technologies.length ? (
                <div className="flex flex-col gap-3">
                  {[
                    ["Keywords", c.keywords],
                    ["Technologies", c.technologies],
                  ].map(([label, values]) =>
                    (values as string[]).length ? (
                      <div key={label as string} className="flex flex-col gap-1.5">
                        <h3 className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
                          {label as string}
                        </h3>
                        <div className="flex flex-wrap gap-1">
                          {(values as string[]).slice(0, 30).map((v) => (
                            <span key={v} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}

              <Tabs defaultValue="people" className="min-w-0">
                <TabsList className="max-w-full overflow-x-auto">
                  <TabsTrigger value="people">
                    People <span className="font-mono text-xs tabular-nums">{current.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="jobs">
                    Job postings <span className="font-mono text-xs tabular-nums">{data.jobs.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="news">
                    News <span className="font-mono text-xs tabular-nums">{data.news.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="sources">Sources</TabsTrigger>
                </TabsList>
                <TabsContent value="people" className="pt-2">
                  {data.people.length ? (
                    <ul className="flex flex-col divide-y rounded-lg border" aria-label="People">
                      {data.people.map((p) => {
                        const saved = p.savedContactId ?? actions.savedNow[p.id] ?? null;
                        return (
                          <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-medium">{p.name}</span>
                              <span className="truncate text-muted-foreground text-xs">
                                {[p.title, seniorityLabel(p.seniority)].filter(Boolean).join(" · ") ||
                                  "No title listed"}
                              </span>
                            </div>
                            {p.goneAt ? (
                              <Badge
                                variant="secondary"
                                className="bg-amber-500/10 font-medium text-amber-700 dark:text-amber-400"
                              >
                                No longer listed
                              </Badge>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <IndexEmailCell
                                  person={{ id: p.id, name: p.name, emailAvailable: p.emailAvailable }}
                                  actions={actions}
                                  canAccess={permissions.accessEmail}
                                />
                                {saved ? (
                                  <SavedLink href={`/dashboard/people/${saved}`} />
                                ) : permissions.savePerson ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={actions.busy.has(p.id)}
                                    aria-label={`Save ${p.name}`}
                                    onClick={() => void actions.save("contact", [p.id])}
                                  >
                                    <BookmarkPlus data-icon="inline-start" aria-hidden="true" />
                                    Save
                                  </Button>
                                ) : null}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">No people found on this company's public pages yet.</p>
                  )}
                </TabsContent>
                <TabsContent value="jobs" className="pt-2">
                  {data.jobs.length ? (
                    <ul className="flex flex-col divide-y rounded-lg border" aria-label="Job postings">
                      {data.jobs.map((j) => (
                        <li key={j.id} className="flex flex-col gap-0.5 p-3">
                          <ExternalA href={j.url}>{j.title}</ExternalA>
                          <span className="text-muted-foreground text-xs">
                            {[j.department, j.location, j.source].filter(Boolean).join(" · ")} · seen{" "}
                            <When at={j.lastSeenAt} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">No job postings found.</p>
                  )}
                </TabsContent>
                <TabsContent value="news" className="pt-2">
                  {data.news.length ? (
                    <ul className="flex flex-col divide-y rounded-lg border" aria-label="News">
                      {data.news.map((n) => (
                        <li key={n.id} className="flex flex-col gap-0.5 p-3">
                          <ExternalA href={n.url}>{n.title}</ExternalA>
                          <span className="text-muted-foreground text-xs">
                            {n.source} · <When at={n.publishedAt ?? n.firstSeenAt} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-sm">No news found.</p>
                  )}
                </TabsContent>
                <TabsContent value="sources" className="pt-2">
                  <SourcesList provenance={data.provenance} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SourcesList({ provenance }: { provenance: unknown }) {
  const entries = (Array.isArray(provenance) ? provenance : []).flatMap((p: unknown) => {
    if (!p || typeof p !== "object") return [];
    const e = p as { source?: unknown; url?: unknown; retrievedAt?: unknown };
    return [
      {
        source: typeof e.source === "string" ? e.source : "unknown",
        url: typeof e.url === "string" ? e.url : null,
        at: typeof e.retrievedAt === "string" ? e.retrievedAt : null,
      },
    ];
  });
  if (!entries.length) return <p className="text-muted-foreground text-sm">No sources recorded.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border" aria-label="Sources">
      {entries.slice(0, 50).map((e) => (
        <li key={`${e.source}-${e.url}-${e.at}`} className="flex flex-col gap-0.5 p-3">
          {e.url ? <ExternalA href={e.url}>{e.url}</ExternalA> : <span>{e.source}</span>}
          <span className="text-muted-foreground text-xs">
            <span className="font-mono">{e.source}</span> · <When at={e.at} />
          </span>
        </li>
      ))}
    </ul>
  );
}
