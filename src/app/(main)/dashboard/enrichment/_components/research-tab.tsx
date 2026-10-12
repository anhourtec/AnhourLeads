import Link from "next/link";

import { Globe, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ResearchTab({ canOpen }: { canOpen: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
          Research a company's website
        </CardTitle>
        <CardDescription className="max-w-prose">
          Crawl a company's public pages for contact details, people, technologies and hiring signals, then apply what
          you find to the company with its source. Only public pages are fetched and robots.txt is respected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canOpen ? (
          <Button asChild size="sm">
            <Link href="/dashboard/research">
              <Radar data-icon="inline-start" aria-hidden="true" />
              Open research
            </Link>
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">You don't have access to research.</p>
        )}
      </CardContent>
    </Card>
  );
}
