"use client";

import { RecordsError } from "../../_components/records/records-error";

export default function ListError({ reset }: { reset: () => void }) {
  return <RecordsError what="this list" retry={reset} />;
}
