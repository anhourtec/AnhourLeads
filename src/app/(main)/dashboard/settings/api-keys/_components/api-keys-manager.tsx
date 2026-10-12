"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Ban, KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format-display";
import { can, outranksOrEquals, ROLE_LABELS, type Role } from "@/lib/rbac/permissions";
import type { ApiKeyDto } from "@/server/services/api-keys";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../../_components/pipeline/page-header";
import { Pill } from "../../../_components/pipeline/pills";
import { CreateKeyDialog } from "./create-key-dialog";

export function ApiKeysManager({
  keys,
  role,
  now,
}: {
  readonly keys: ApiKeyDto[];
  readonly role: Role;
  readonly now: string;
}) {
  const router = useRouter();
  const [toRevoke, setToRevoke] = useState<ApiKeyDto | null>(null);
  const canCreate = can(role, "apikey:create");
  const canRevoke = can(role, "apikey:revoke");
  const reference = new Date(now);

  async function revoke(): Promise<boolean> {
    if (!toRevoke) return true;
    const res = await apiFetch(`/api/v1/api_keys/${toRevoke.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`"${toRevoke.name}" revoked`);
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="API keys"
        description="Let other tools use this workspace's API. Each key has a role and is shown only once when it's created."
        actions={canCreate ? <CreateKeyDialog role={role} /> : null}
      />
      {keys.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>Create a key to connect a CRM, a script or another tool.</EmptyDescription>
          </EmptyHeader>
          {canCreate ? (
            <EmptyContent>
              <CreateKeyDialog role={role} />
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id} className={key.revokedAt ? "text-muted-foreground" : undefined}>
                  <TableCell className="max-w-56 truncate pl-4 font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-xs">{key.prefix}_…</TableCell>
                  <TableCell>{ROLE_LABELS[key.role]}</TableCell>
                  <TableCell className="text-xs">
                    <time dateTime={key.createdAt} title={formatDateTime(key.createdAt)}>
                      {formatDate(key.createdAt)}
                    </time>
                    {key.createdBy ? <span className="block text-muted-foreground">{key.createdBy.name}</span> : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {key.lastUsedAt ? (
                      <time dateTime={key.lastUsedAt} title={formatDateTime(key.lastUsedAt)}>
                        {relativeTime(key.lastUsedAt, reference)}
                      </time>
                    ) : (
                      "Never"
                    )}
                  </TableCell>
                  <TableCell>
                    {key.revokedAt ? <Pill tone="negative">Revoked</Pill> : <Pill tone="positive">Active</Pill>}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {canRevoke && !key.revokedAt && outranksOrEquals(role, key.role) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setToRevoke(key)}
                        aria-label={`Revoke ${key.name}`}
                      >
                        <Ban data-icon="inline-start" />
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(open) => !open && setToRevoke(null)}
        title={`Revoke "${toRevoke?.name ?? ""}"?`}
        description="Anything using this key stops working straight away. This can't be undone."
        confirmLabel="Revoke key"
        pendingLabel="Revoking…"
        icon={<Ban data-icon="inline-start" />}
        onConfirm={revoke}
      />
    </div>
  );
}
