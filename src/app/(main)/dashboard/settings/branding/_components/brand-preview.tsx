import { LogIn, Radar, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrandColor } from "@/config/brand";

interface BrandPreviewProps {
  name: string;
  color: BrandColor;
  supportEmail: string | null;
}

/** A scoped mock of the sidebar header, a primary action and the sign-in card in the chosen brand. */
export function BrandPreview({ name, color, supportEmail }: BrandPreviewProps) {
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle>Preview</CardTitle>
        <CardDescription>How the brand looks. Nothing changes until you save.</CardDescription>
      </CardHeader>
      <CardContent>
        <div data-brand-preview={color} data-testid="brand-preview" className="flex flex-col gap-4" aria-live="polite">
          <section aria-label="Sidebar preview" className="rounded-lg border bg-sidebar p-2 text-sidebar-foreground">
            <div className="flex min-w-0 items-center gap-2 rounded-md p-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Radar className="size-4" aria-hidden="true" />
              </span>
              <span className="truncate font-semibold text-base" data-testid="preview-name">
                {name}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm">
              <Send className="size-4 text-sidebar-primary" aria-hidden="true" />
              <span className="truncate">Sequences</span>
              <Badge className="ml-auto">3 active</Badge>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2" inert>
            <Button size="sm" type="button">
              <Send data-icon="inline-start" aria-hidden="true" />
              Launch sequence
            </Button>
            <Button size="sm" variant="outline" type="button">
              Cancel
            </Button>
          </div>

          <section aria-label="Sign-in page preview" className="rounded-lg border bg-background p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Radar className="size-3.5" aria-hidden="true" />
              </span>
              <span className="truncate font-semibold text-sm">{name}</span>
            </div>
            <p className="mt-4 font-medium text-lg">Sign in to {name}</p>
            <div className="mt-3 space-y-2" aria-hidden="true">
              <div className="h-8 rounded-lg border bg-transparent" />
              <div className="h-8 rounded-lg border bg-transparent" />
              <div className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary font-medium text-primary-foreground text-sm">
                <LogIn className="size-4" />
                Sign in
              </div>
            </div>
            <p className="mt-4 text-muted-foreground text-xs">
              {supportEmail ? (
                <>
                  Need help? <span className="font-mono text-foreground">{supportEmail}</span>
                </>
              ) : (
                "No support email is shown."
              )}
            </p>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
