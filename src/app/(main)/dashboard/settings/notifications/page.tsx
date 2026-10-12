import { Info } from "lucide-react";
import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { PageHeader } from "../../_components/pipeline/page-header";

export const metadata: Metadata = { title: "Notification settings" };

const TYPES: { id: string; title: string; description: string }[] = [
  {
    id: "sequence_paused",
    title: "Sequence paused by bounce guard",
    description: "A sequence you own stopped sending because too many emails bounced.",
  },
  { id: "reply_received", title: "Reply received", description: "Someone replied to an email you sent." },
  { id: "task_assigned", title: "Task assigned to you", description: "A teammate or a workflow gave you a task." },
  {
    id: "job_finished",
    title: "Import or enrichment job finished",
    description: "A CSV import or enrichment job you started is done.",
  },
  { id: "workflow_failed", title: "Workflow failed", description: "A workflow you own couldn't finish a run." },
  {
    id: "invitation_accepted",
    title: "Invitation accepted",
    description: "Someone you invited joined the workspace.",
  },
];

export default function NotificationSettingsPage() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader title="Notification settings" description="What you're told about, and where." />
      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>In-app notifications are always on</AlertTitle>
        <AlertDescription>
          They appear under the bell in the top bar. Choosing which types also reach you by email isn't available yet.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Notification types</CardTitle>
          <CardDescription>Everything that can notify you in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Notification</TableHead>
                  <TableHead>In app</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TYPES.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="min-w-56 whitespace-normal">
                      <p className="font-medium text-sm">{type.title}</p>
                      <p className="text-muted-foreground text-xs">{type.description}</p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
                      >
                        On
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-muted font-medium text-muted-foreground">
                        Coming soon
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
