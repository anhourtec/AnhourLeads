"use client";

import { useId, useState } from "react";

import { Radar } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { CrawlJobView } from "@/server/services/research";

import { apiError } from "./format";
import type { CompanyOption } from "./research-workspace";

const PAGE_LIMITS = [5, 10, 25];

export function NewCrawlCard({
  companies,
  onCreated,
  className,
}: {
  companies: CompanyOption[];
  onCreated: (job: CrawlJobView) => void;
  className?: string;
}) {
  const ids = { url: useId(), company: useId(), pages: useId() };
  const [url, setUrl] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!url.trim() && !companyId) {
      setError("Enter a website or pick a company.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/v1/crawl_jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() || undefined, companyId: companyId || undefined, maxPages }),
      });
      if (!res.ok) {
        setError(await apiError(res, "The crawl couldn't be started."));
        return;
      }
      const { crawl_job } = (await res.json()) as { crawl_job: CrawlJobView };
      onCreated(crawl_job);
      setUrl("");
      setCompanyId("");
      toast.success("Crawl queued", { description: crawl_job.domain ?? crawl_job.seedUrl });
    } catch {
      setError("The crawl couldn't be started. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>New crawl</CardTitle>
        <CardDescription>Start from a website, a company, or both to link the results to it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={ids.url}>Website</FieldLabel>
                <Input
                  id={ids.url}
                  name="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="acme.com"
                  className="font-mono"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.company}>Company</FieldLabel>
                <NativeSelect
                  id={ids.company}
                  name="companyId"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">{companies.length ? "None" : "No companies yet"}</NativeSelectOption>
                  {companies.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.domain ? `${c.name} (${c.domain})` : c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <Field className="sm:w-40">
                <FieldLabel htmlFor={ids.pages}>Page limit</FieldLabel>
                <NativeSelect
                  id={ids.pages}
                  value={String(maxPages)}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  className="w-full"
                >
                  {PAGE_LIMITS.map((n) => (
                    <NativeSelectOption key={n} value={String(n)}>
                      {n} pages
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Button type="submit" size="sm" disabled={pending}>
                <Radar data-icon="inline-start" />
                {pending ? "Starting…" : "Start crawl"}
              </Button>
            </div>
            <FieldDescription>
              Leave the website empty to use the company's website. Key pages such as about, team, contact and careers
              are fetched first.
            </FieldDescription>
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
