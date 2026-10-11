"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format-display";
import type { DealDto } from "@/server/services/deals";

import { Pill, type Tone } from "../../_components/pipeline/pills";

const TYPE_TONE: Record<DealDto["stageType"], Tone> = { open: "info", won: "positive", lost: "negative" };

export function DealStagePill({ deal }: { deal: Pick<DealDto, "stageName" | "stageType"> }) {
  return <Pill tone={TYPE_TONE[deal.stageType]}>{deal.stageName}</Pill>;
}

export function DealsTable({
  deals,
  currentUserId,
  showPipeline,
  onOpen,
}: {
  readonly deals: DealDto[];
  readonly currentUserId: string;
  readonly showPipeline: boolean;
  readonly onOpen: (deal: DealDto) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="table-head-mono pl-4">Deal</TableHead>
            <TableHead className="table-head-mono">Stage</TableHead>
            {showPipeline ? <TableHead className="table-head-mono">Pipeline</TableHead> : null}
            <TableHead className="table-head-mono text-right">Amount</TableHead>
            <TableHead className="table-head-mono">Company</TableHead>
            <TableHead className="table-head-mono">Owner</TableHead>
            <TableHead className="table-head-mono pr-4">Close date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="max-w-72 pl-4">
                <button
                  type="button"
                  onClick={() => onOpen(deal)}
                  className="truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {deal.name}
                </button>
                {deal.contact ? (
                  <div className="truncate text-muted-foreground text-xs">{deal.contact.name}</div>
                ) : null}
              </TableCell>
              <TableCell>
                <DealStagePill deal={deal} />
              </TableCell>
              {showPipeline ? <TableCell className="max-w-40 truncate">{deal.pipelineName ?? "—"}</TableCell> : null}
              <TableCell className="text-right font-mono tabular-nums">
                {formatMoney(deal.amount, deal.currency)}
              </TableCell>
              <TableCell className="max-w-48 truncate">{deal.company?.name ?? "—"}</TableCell>
              <TableCell className="max-w-40 truncate">
                {deal.owner?.id === currentUserId ? "You" : (deal.owner?.name ?? "No owner")}
              </TableCell>
              <TableCell className="pr-4 tabular-nums">{formatDate(deal.closeDate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
