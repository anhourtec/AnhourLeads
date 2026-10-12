import { readJson, route } from "@/server/http/route";
import {
  deleteWorkspace,
  getWorkspace,
  renameWorkspace,
  workspaceDeleteSchema,
  workspaceUpdateSchema,
} from "@/server/services/workspace";

export const GET = route(async ({ actor }) => ({ workspace: await getWorkspace(actor) }));

/** Rename the workspace. Branding has its own endpoint. */
export const PATCH = route(
  async ({ req, actor }) => {
    const { name } = workspaceUpdateSchema.parse(await readJson(req));
    return { workspace: await renameWorkspace(actor, name) };
  },
  { permission: "workspace:update" },
);

/** Delete the workspace and all its data. Body: { confirm: "<workspace name>" }. */
export const DELETE = route(
  async ({ req, actor }) => {
    const { confirm } = workspaceDeleteSchema.parse(await readJson(req));
    return deleteWorkspace(actor, confirm);
  },
  { permission: "workspace:delete" },
);
