/**
 * Sending protection policy vocabulary, shared by the settings screen (email setup and health), the
 * policy API and the sending engine. The engine marks a message it holds back because of a policy
 * with `blockedReason` starting with POLICY_BLOCK_PREFIX, and writes an audit entry with
 * AUTO_PAUSE_AUDIT_ACTION when bounce guard (or an authentication problem) pauses a sequence, so the
 * settings screen can count both.
 */
export const POLICY_BLOCK_PREFIX = "Policy:";

export const POLICY_BLOCK_REASONS = {
  unverified: `${POLICY_BLOCK_PREFIX} the address isn't verified.`,
  catchAll: `${POLICY_BLOCK_PREFIX} the address is on a catch-all domain.`,
  signature: `${POLICY_BLOCK_PREFIX} the mailbox has no signature.`,
  workspaceLimit: `${POLICY_BLOCK_PREFIX} the workspace daily sending limit was reached.`,
  ramp: `${POLICY_BLOCK_PREFIX} the mailbox is still ramping up.`,
  authentication: `${POLICY_BLOCK_PREFIX} the sending domain fails authentication checks.`,
} as const;

export const AUTO_PAUSE_AUDIT_ACTION = "sequence.auto_pause";

export interface SendingPolicyView {
  autoPauseOnAuthIssue: boolean;
  restrictUnverified: boolean;
  restrictCatchAll: boolean;
  requireSignature: boolean;
  /** Always on; shown as a disabled switch. */
  oneClickUnsubscribe: true;
  gradualRamp: boolean;
  bounceGuard: boolean;
  /** Fraction, 0.05 = 5%. */
  bounceThreshold: number;
  workspaceDailyLimit: number | null;
  updatedAt: string | null;
}

export const DEFAULT_SENDING_POLICY: Omit<SendingPolicyView, "updatedAt"> = {
  autoPauseOnAuthIssue: false,
  restrictUnverified: false,
  restrictCatchAll: true,
  requireSignature: false,
  oneClickUnsubscribe: true,
  gradualRamp: false,
  bounceGuard: true,
  bounceThreshold: 0.05,
  workspaceDailyLimit: null,
};
