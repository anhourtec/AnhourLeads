"use client";

import { RecordsError } from "../_components/records/records-error";

export default function SequencesError({ reset }: { reset: () => void }) {
  return <RecordsError what="sequences" retry={reset} />;
}
