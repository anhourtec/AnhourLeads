"use client";

import { useState } from "react";

import { Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Destructive confirm. `onConfirm` returns an error message to keep the dialog open, or null. */
export function ConfirmDeleteDialog({
  title,
  description,
  triggerLabel = "Delete",
  confirmLabel = "Delete",
  onConfirm,
}: {
  title: string;
  description: string;
  triggerLabel?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const failure = await onConfirm();
              setPending(false);
              if (failure) setError(failure);
              else setOpen(false);
            }}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
