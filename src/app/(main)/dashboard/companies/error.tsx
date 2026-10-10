"use client";

import { RecordsError } from "../_components/records/records-error";

export default function CompaniesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RecordsError what="companies" retry={retry} />;
}
