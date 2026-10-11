"use client";

import { Badge } from "@/components/ui/badge";
import { ACTION_BLOCKS, AGENT_BLOCKS, BLOCK_INFO, type BlockType, RULE_BLOCKS } from "@/lib/workflows";

import { BLOCK_ICONS } from "./canvas";

const GROUPS: { title: string; blocks: readonly BlockType[]; badge?: string }[] = [
  { title: "Rules", blocks: RULE_BLOCKS },
  { title: "Agents", blocks: AGENT_BLOCKS, badge: "New" },
  { title: "Actions", blocks: ACTION_BLOCKS },
];

/** Build palette: click a block to add it to the highlighted path. */
export function Palette({
  onAdd,
  disabled,
}: {
  readonly onAdd: (type: BlockType) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-sm">Build</h2>
        <p className="text-muted-foreground text-xs">Click a block to add it where the + is highlighted.</p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title} className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-2 text-sm">
            {g.title}
            {g.badge ? (
              <Badge variant="secondary" className="bg-sky-500/10 text-sky-700 dark:text-sky-400">
                {g.badge}
              </Badge>
            ) : null}
          </h3>
          {g.blocks.map((type) => {
            const Icon = BLOCK_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                disabled={disabled}
                onClick={() => onAdd(type)}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left text-sm outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                {BLOCK_INFO[type].label}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
