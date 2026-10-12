"use client";

import { RecordsError } from "../../_components/records/records-error";

export default function CompanyError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RecordsError what="this company" retry={retry} />;
}
