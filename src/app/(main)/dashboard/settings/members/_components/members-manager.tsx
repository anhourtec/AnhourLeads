"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { MailX, UserMinus, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTime } from "@/lib/format-display";
import { can, ROLE_LABELS, type Role } from "@/lib/rbac/permissions";
import { getInitials } from "@/lib/utils";
import type { InvitationDto, MemberDto } from "@/server/services/members";

import { ConfirmDialog } from "../../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../../_components/pipeline/page-header";
import { Pill } from "../../../_components/pipeline/pills";
import { InviteDialog } from "./invite-dialog";
import { canManage, grantableRoles } from "./role-rules";

function RoleControl({
  member,
  actorRole,
  canUpdate,
  isSelf,
  busy,
  onChange,
}: {
  member: MemberDto;
  actorRole: Role;
  canUpdate: boolean;
  isSelf: boolean;
  busy: boolean;
  onChange: (member: MemberDto, role: Role) => void;
}) {
  if (!canUpdate || !canManage(actorRole, member.role)) {
    return <Pill tone={member.role === "owner" ? "info" : "neutral"}>{ROLE_LABELS[member.role]}</Pill>;
  }
  const options = grantableRoles(actorRole);
  return (
    <NativeSelect
      size="sm"
      aria-label={isSelf ? "Your role" : `Role for ${member.name}`}
      value={member.role}
      disabled={busy}
      onChange={(e) => onChange(member, e.target.value as Role)}
      className="w-36"
    >
      {options.map((r) => (
        <NativeSelectOption key={r} value={r}>
          {ROLE_LABELS[r]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function MembersManager({
  members,
  total,
  invitations,
  role,
  currentUserId,
  workspaceName,
}: {
  readonly members: MemberDto[];
  readonly total: number;
  readonly invitations: InvitationDto[];
  readonly role: Role;
  readonly currentUserId: string;
  readonly workspaceName: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<MemberDto | null>(null);
  const [toCancel, setToCancel] = useState<InvitationDto | null>(null);
  const canInvite = can(role, "member:invite");
  const canUpdate = can(role, "member:update");
  const canRemove = can(role, "member:remove");

  async function changeRole(member: MemberDto, next: Role) {
    if (next === member.role) return;
    setBusyId(member.id);
    const res = await apiFetch(`/api/v1/users/${member.id}`, { method: "PATCH", body: { role: next } });
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error);
      router.refresh();
      return;
    }
    toast.success(`${member.name} is now ${ROLE_LABELS[next].toLowerCase()}`);
    router.refresh();
  }

  async function remove(): Promise<boolean> {
    if (!toRemove) return true;
    const res = await apiFetch(`/api/v1/users/${toRemove.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`${toRemove.name} was removed`);
    if (toRemove.id === currentUserId) {
      router.replace("/dashboard/overview");
    }
    router.refresh();
    return true;
  }

  async function cancelInvite(): Promise<boolean> {
    if (!toCancel) return true;
    const res = await apiFetch(`/api/v1/users/invitations/${toCancel.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success("Invitation cancelled");
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Members"
        description="People in this workspace and what they can do. Nobody can grant a role above their own."
        actions={canInvite ? <InviteDialog role={role} workspaceName={workspaceName} /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            <span className="font-mono tabular-nums">{total}</span> {total === 1 ? "member" : "members"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No members</EmptyTitle>
                <EmptyDescription>Invite people to work in this workspace.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y" aria-label="Members">
              {members.map((member) => {
                const isSelf = member.id === currentUserId;
                const removable = canRemove && canManage(role, member.role);
                return (
                  <li
                    key={member.id}
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    data-testid="member-row"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg text-xs">{getInitials(member.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-sm">
                          {member.name}
                          {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                        </span>
                        <span className="truncate font-mono text-muted-foreground text-xs">{member.email}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-11 sm:pl-0">
                      <span className="hidden text-muted-foreground text-xs md:inline">
                        Joined {formatDate(member.joinedAt)}
                      </span>
                      <RoleControl
                        member={member}
                        actorRole={role}
                        canUpdate={canUpdate}
                        isSelf={isSelf}
                        busy={busyId === member.id}
                        onChange={(m, r) => void changeRole(m, r)}
                      />
                      {removable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToRemove(member)}
                          aria-label={isSelf ? "Leave workspace" : `Remove ${member.name}`}
                        >
                          <UserMinus data-icon="inline-start" />
                          {isSelf ? "Leave" : "Remove"}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canInvite ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invitations expire 7 days after they're sent.</CardDescription>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No pending invitations.</p>
            ) : (
              <ul className="flex flex-col divide-y" aria-label="Pending invitations">
                {invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-sm">{inv.email}</span>
                      <span className="text-muted-foreground text-xs">
                        {ROLE_LABELS[inv.role]}
                        {inv.inviter ? ` · invited by ${inv.inviter.name}` : ""}
                        {inv.expiresAt ? (
                          <>
                            {" · expires "}
                            <time dateTime={inv.expiresAt} title={formatDateTime(inv.expiresAt)}>
                              {formatDate(inv.expiresAt)}
                            </time>
                          </>
                        ) : null}
                      </span>
                    </div>
                    {canManage(role, inv.role) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start sm:self-auto"
                        onClick={() => setToCancel(inv)}
                      >
                        <MailX data-icon="inline-start" />
                        Cancel invitation
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title={toRemove?.id === currentUserId ? "Leave this workspace?" : `Remove ${toRemove?.name ?? ""}?`}
        description={
          toRemove?.id === currentUserId
            ? "You'll lose access straight away. Someone will need to invite you again."
            : "They'll lose access straight away. Records they own stay in the workspace."
        }
        confirmLabel={toRemove?.id === currentUserId ? "Leave workspace" : "Remove member"}
        pendingLabel="Removing…"
        icon={<UserMinus data-icon="inline-start" />}
        onConfirm={remove}
      />
      <ConfirmDialog
        open={toCancel !== null}
        onOpenChange={(open) => !open && setToCancel(null)}
        title="Cancel this invitation?"
        description={`The link sent to ${toCancel?.email ?? ""} will stop working.`}
        confirmLabel="Cancel invitation"
        pendingLabel="Cancelling…"
        icon={<MailX data-icon="inline-start" />}
        onConfirm={cancelInvite}
      />
    </div>
  );
}
