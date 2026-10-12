import type { Metadata } from "next";

import { RemovalForm } from "./_components/removal-form";

export const metadata: Metadata = { title: "Remove your information", robots: { index: false } };

export default function RemovalPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-3">
        <h1 className="page-title">Remove your information</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This installation keeps a business index built only from public sources: company websites (their about, team,
          contact and careers pages, news feeds and public job boards) and Wikidata. Its crawler identifies itself,
          obeys robots.txt and never logs in anywhere or reads social networks.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Ask for an email address or a whole domain to be removed. Once you confirm, what the index holds about it is
          deleted and it is never added again. Every request is confirmed first, so nobody can remove someone else.
        </p>
      </div>
      <RemovalForm />
    </div>
  );
}
