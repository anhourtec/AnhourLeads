"use client";

import { RecordsError } from "../_components/records/records-error";

export default function MailboxesError({ reset }: { reset: () => void }) {
  return <RecordsError what="mailboxes" retry={reset} />;
}
