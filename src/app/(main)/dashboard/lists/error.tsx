"use client";

import { RecordsError } from "../_components/records/records-error";

export default function ListsError({ reset }: { reset: () => void }) {
  return <RecordsError what="lists" retry={reset} />;
}
