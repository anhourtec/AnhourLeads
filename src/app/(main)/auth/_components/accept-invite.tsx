"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Check } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AcceptInvite({
  invitationId,
  signedIn,
}: {
  readonly invitationId: string;
  readonly signedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!signedIn) {
    const next = encodeURIComponent(`/auth/accept-invite/${invitationId}`);
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Sign in with the invited email address to accept, or create an account first.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={`/auth/login?next=${next}`}>Sign in</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/auth/register?next=${next}`}>Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  async function accept() {
    setPending(true);
    const { error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    setPending(false);
    if (acceptError) {
      setError("This invitation is invalid, expired, or was sent to a different email address.");
      return;
    }
    router.replace("/dashboard/overview");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button size="lg" className="w-full" onClick={accept} disabled={pending}>
        <Check data-icon="inline-start" />
        Accept invitation
      </Button>
    </div>
  );
}
