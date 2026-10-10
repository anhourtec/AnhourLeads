"use client";

import { RecordsError } from "../../_components/records/records-error";

export default function SequenceError({ reset }: { reset: () => void }) {
  return <RecordsError what="this sequence" retry={reset} />;
}
