"use client";

import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser auth client. No baseURL: it talks to the current hostname, so white-label hosts work. */
export const authClient = createAuthClient({
  plugins: [organizationClient(), adminClient()],
});
