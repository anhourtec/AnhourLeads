import { type BlockType, BRANCHING_BLOCKS, branchKeys, type WorkflowBlock } from "@/lib/workflows";

/** A path in the block tree that blocks can be added to: the root, or one path of a branch block. */
export interface Lane {
  parentId: string | null;
  branchKey: string | null;
}

export const ROOT_LANE: Lane = { parentId: null, branchKey: null };

export const sameLane = (a: Lane, b: Lane) => a.parentId === b.parentId && a.branchKey === b.branchKey;

export const isTerminal = (type: BlockType) => type === "exit" || BRANCHING_BLOCKS.includes(type);

/** Apply `fn` to the array of blocks in `lane`, returning a new tree. */
export function mapLane(
  blocks: WorkflowBlock[],
  lane: Lane,
  fn: (list: WorkflowBlock[]) => WorkflowBlock[],
): WorkflowBlock[] {
  if (lane.parentId === null) return fn(blocks);
  return blocks.map((b) => {
    if (b.id === lane.parentId && lane.branchKey !== null) {
      return { ...b, branches: { ...b.branches, [lane.branchKey]: fn(b.branches?.[lane.branchKey] ?? []) } };
    }
    if (!b.branches) return b;
    return {
      ...b,
      branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, mapLane(v, lane, fn)])),
    };
  });
}

export function laneBlocks(blocks: WorkflowBlock[], lane: Lane): WorkflowBlock[] {
  if (lane.parentId === null) return blocks;
  const parent = findBlock(blocks, lane.parentId);
  return parent?.branches?.[lane.branchKey ?? ""] ?? [];
}

export function findBlock(blocks: WorkflowBlock[], id: string): WorkflowBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    for (const child of Object.values(b.branches ?? {})) {
      const found = findBlock(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** The lane a block lives in. */
export function laneOf(blocks: WorkflowBlock[], id: string, lane: Lane = ROOT_LANE): Lane | null {
  for (const b of blocks) {
    if (b.id === id) return lane;
    for (const [key, child] of Object.entries(b.branches ?? {})) {
      const found = laneOf(child, id, { parentId: b.id, branchKey: key });
      if (found) return found;
    }
  }
  return null;
}

/** Add a block to a lane: at the end, or before the lane's branch/exit block. Null when not possible. */
export function addToLane(blocks: WorkflowBlock[], lane: Lane, block: WorkflowBlock): WorkflowBlock[] | null {
  const list = laneBlocks(blocks, lane);
  const last = list[list.length - 1];
  if (last && isTerminal(last.type) && isTerminal(block.type)) return null;
  return mapLane(blocks, lane, (l) => {
    const end = l[l.length - 1];
    return end && isTerminal(end.type) ? [...l.slice(0, -1), block, end] : [...l, block];
  });
}

export function removeBlock(blocks: WorkflowBlock[], id: string): WorkflowBlock[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) =>
      b.branches
        ? { ...b, branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, removeBlock(v, id)])) }
        : b,
    );
}

/** Replace a block's config, keeping branch paths in step with the config's path keys. */
export function updateBlock(blocks: WorkflowBlock[], id: string, config: Record<string, unknown>): WorkflowBlock[] {
  return blocks.map((b) => {
    if (b.id === id) {
      const next: WorkflowBlock = { ...b, config };
      if (BRANCHING_BLOCKS.includes(b.type)) {
        next.branches = Object.fromEntries(branchKeys(next).map(({ key }) => [key, b.branches?.[key] ?? []]));
      }
      return next;
    }
    return b.branches
      ? {
          ...b,
          branches: Object.fromEntries(Object.entries(b.branches).map(([k, v]) => [k, updateBlock(v, id, config)])),
        }
      : b;
  });
}
