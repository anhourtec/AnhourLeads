"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { apiFetch } from "@/lib/api-fetch";

/** Create a draft (blank or from a template) and open it in the builder. */
export function useCreateWorkflow() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  async function create(templateId?: string, extra: Record<string, unknown> = {}) {
    setPending(templateId ?? "blank");
    const res = await apiFetch<{ workflow: { id: string } }>("/api/v1/workflows", {
      method: "POST",
      body: { ...(templateId ? { templateId } : {}), ...extra },
    });
    if (!res.ok) {
      setPending(null);
      toast.error(res.error);
      return;
    }
    router.push(`/dashboard/workflows/${res.data.workflow.id}`);
  }
  return { create, pending };
}
