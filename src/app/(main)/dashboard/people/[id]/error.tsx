"use client";

import { RecordsError } from "../../_components/records/records-error";

export default function PersonError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RecordsError what="this person" retry={retry} />;
}
