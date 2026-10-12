"use client";

import { useState } from "react";

import Link from "next/link";

import { Building2, Info, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SuggestedCompany, SuggestedPerson } from "@/server/services/home";

type Mode = "people" | "companies";

/** "Suggested leads" with a People / Companies toggle, scored from data already in the workspace. */
export function SuggestedLeads({
  people,
  companies,
}: {
  readonly people: readonly SuggestedPerson[] | null;
  readonly companies: readonly SuggestedCompany[] | null;
}) {
  const [mode, setMode] = useState<Mode>(people ? "people" : "companies");
  const rows = mode === "people" ? people : companies;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Suggested leads
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="How suggestions are scored"
              >
                <Info className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              People score for a verified email, seniority and not being contacted yet. Companies score for how many
              reachable people they have. Anyone already in a sequence or opted out is left out.
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={mode}
          onValueChange={(value) => value && setMode(value as Mode)}
          aria-label="Suggest"
          className="self-start"
        >
          {people ? (
            <ToggleGroupItem value="people" aria-label="People">
              <Users aria-hidden="true" />
              People
            </ToggleGroupItem>
          ) : null}
          {companies ? (
            <ToggleGroupItem value="companies" aria-label="Companies">
              <Building2 aria-hidden="true" />
              Companies
            </ToggleGroupItem>
          ) : null}
        </ToggleGroup>
        {!rows?.length ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
            {mode === "people" ? (
              <Users className="size-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />
            )}
            <p className="font-medium text-sm">No suggestions yet</p>
            <p className="max-w-sm text-muted-foreground text-sm">
              {mode === "people"
                ? "Add people with verified emails and their seniority, and the ones worth reaching first show up here."
                : "Companies show up here once they have people with verified emails who haven't been contacted."}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link prefetch={false} href={mode === "people" ? "/dashboard/people" : "/dashboard/companies"}>
                {mode === "people" ? "Find people" : "Find companies"}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            {mode === "people" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(people ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-56">
                        <Link
                          prefetch={false}
                          href={`/dashboard/people/${p.id}`}
                          className="font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
                        {p.title ? <p className="truncate text-muted-foreground text-xs">{p.title}</p> : null}
                      </TableCell>
                      <TableCell className="text-sm">{p.company ?? "–"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {p.reasons.map((r) => (
                            <Badge key={r} variant="secondary" className="font-medium">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{p.score}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(companies ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-56">
                        <Link
                          prefetch={false}
                          href={`/dashboard/companies/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.name}
                        </Link>
                        {c.employeeCount ? (
                          <p className="font-mono text-muted-foreground text-xs tabular-nums">
                            {c.employeeCount.toLocaleString()} employees
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">{c.industry ?? "–"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.reasons.map((r) => (
                            <Badge key={r} variant="secondary" className="font-medium">
                              {r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{c.score}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
