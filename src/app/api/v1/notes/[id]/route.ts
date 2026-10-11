import { route } from "@/server/http/route";
import { deleteNote } from "@/server/services/notes";

/** Delete a note: your own, or anyone's with note:delete (managers and above). */
export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteNote(actor, params.id), {
  permission: "note:create",
});
