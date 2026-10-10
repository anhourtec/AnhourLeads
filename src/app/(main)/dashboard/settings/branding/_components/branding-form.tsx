"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type BrandColor, isBrandColor } from "@/config/brand";
import type { BrandingView } from "@/server/services/branding";

import { BrandPreview } from "./brand-preview";
import { colorLabel, SWATCH } from "./swatches";

type FieldName = "brandName" | "brandColor" | "supportEmail";
type FieldErrors = Partial<Record<FieldName, string>>;

interface ApiError {
  error?: string;
  details?: { path: string; message: string }[];
}

export function BrandingForm({ initial }: { initial: BrandingView }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.brandName ?? "");
  const [color, setColor] = useState<BrandColor>(initial.brandColor ?? initial.defaults.color);
  const [email, setEmail] = useState(initial.supportEmail ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty =
    name.trim() !== (saved.brandName ?? "") ||
    color !== (saved.brandColor ?? saved.defaults.color) ||
    email.trim() !== (saved.supportEmail ?? "");
  const atDefaults = !name.trim() && color === saved.defaults.color && !email.trim();

  function resetToDefaults() {
    setName("");
    setColor(saved.defaults.color);
    setEmail("");
    setErrors({});
    toast("Defaults restored in the form. Save to apply them.");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch("/api/v1/workspace/branding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brandName: name.trim() || null,
          brandColor: color === saved.defaults.color ? null : color,
          supportEmail: email.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiError & { branding?: BrandingView };
      if (!res.ok || !data.branding) {
        const fieldErrors: FieldErrors = {};
        for (const d of data.details ?? []) {
          if (d.path === "brandName" || d.path === "brandColor" || d.path === "supportEmail") {
            fieldErrors[d.path] = d.message;
          }
        }
        setErrors(fieldErrors);
        setFormError(Object.keys(fieldErrors).length ? null : (data.error ?? "Couldn't save the brand. Try again."));
        return;
      }
      setSaved(data.branding);
      setName(data.branding.brandName ?? "");
      setColor(data.branding.brandColor ?? data.branding.defaults.color);
      setEmail(data.branding.supportEmail ?? "");
      toast.success("Brand saved.");
      // The shell (sidebar, page title, <html data-brand>) reads the brand on the server.
      router.refresh();
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const previewName = name.trim() || saved.defaults.name;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Card>
        <form noValidate onSubmit={save} className="flex flex-col gap-(--card-spacing)">
          <CardHeader>
            <CardTitle>Workspace brand</CardTitle>
            <CardDescription>Fonts and layout stay the same for every workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-6">
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={Boolean(errors.brandName)}>
                <FieldLabel htmlFor="brand-name">Display name</FieldLabel>
                <Input
                  id="brand-name"
                  value={name}
                  maxLength={60}
                  placeholder={saved.defaults.name}
                  autoComplete="organization"
                  aria-invalid={Boolean(errors.brandName)}
                  aria-describedby="brand-name-help"
                  onChange={(e) => setName(e.target.value)}
                />
                <FieldDescription id="brand-name-help">
                  Shown in the sidebar, page titles, sign-in pages and emails. Leave empty to use the workspace name.
                </FieldDescription>
                {errors.brandName && <FieldError>{errors.brandName}</FieldError>}
              </Field>

              <FieldSet>
                <FieldLegend variant="label">Brand colour</FieldLegend>
                <FieldDescription>
                  Used for primary buttons, the active menu item, focus rings and the logo tile. The default is indigo.
                </FieldDescription>
                <RadioGroup
                  value={color}
                  onValueChange={(v) => isBrandColor(v) && setColor(v)}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
                  aria-label="Brand colour"
                >
                  {saved.colors.map((c) => (
                    <FieldLabel key={c} htmlFor={`brand-color-${c}`} className="w-full">
                      <Field orientation="horizontal" className="items-center gap-2">
                        <RadioGroupItem value={c} id={`brand-color-${c}`} />
                        <span className={`size-4 shrink-0 rounded-full ${SWATCH[c]}`} aria-hidden="true" />
                        <span className="truncate font-normal text-sm">{colorLabel(c)}</span>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {errors.brandColor && <FieldError>{errors.brandColor}</FieldError>}
              </FieldSet>

              <Field data-invalid={Boolean(errors.supportEmail)}>
                <FieldLabel htmlFor="support-email">Support email</FieldLabel>
                <Input
                  id="support-email"
                  type="email"
                  value={email}
                  placeholder="support@example.com"
                  autoComplete="email"
                  className="font-mono"
                  aria-invalid={Boolean(errors.supportEmail)}
                  aria-describedby="support-email-help"
                  onChange={(e) => setEmail(e.target.value)}
                />
                <FieldDescription id="support-email-help">
                  Shown on sign-in pages as "Need help?". Leave empty to hide it.
                </FieldDescription>
                {errors.supportEmail && <FieldError>{errors.supportEmail}</FieldError>}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-end gap-2 border-t py-(--card-spacing)">
            <Button type="button" size="sm" variant="outline" onClick={resetToDefaults} disabled={saving || atDefaults}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Reset to defaults
            </Button>
            <Button type="submit" size="sm" disabled={saving || !dirty}>
              <Save data-icon="inline-start" aria-hidden="true" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>
      <BrandPreview name={previewName} color={color} supportEmail={email.trim() || null} />
    </div>
  );
}
