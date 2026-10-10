"use client";

import { RecordsError } from "../_components/records/records-error";

export default function PeopleError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RecordsError what="people" retry={retry} />;
}
