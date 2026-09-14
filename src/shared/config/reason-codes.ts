// Backend-owned. Desk Why? renders these. Imports nothing.

export const EXCLUSION_REASONS = [
  'missing_cert',
  'cert_expired',
  'tier_too_low',
  'not_clocked_in',
  'on_leave_or_mc',
  'max_minutes_exceeded',
  'no_fit_in_window',
  'missing_parts',
  'missing_tools',
  'locked_job',
  'in_progress',
  'travel_infeasible',
] as const;

export const VALIDATION_VIOLATIONS = [
  'OVERLAP',
  'MISSING_CERT',
  'CERT_EXPIRED',
  'OUTSIDE_SHIFT',
  'WINDOW_INFEASIBLE',
  'TRAVEL_INFEASIBLE',
  'LOCKED_MOVED',
  'IN_PROGRESS_MOVED',
  'DUPLICATE_ASSIGNMENT',
  'MISSING_PARTS',
  'EXCESSIVE_OVERTIME',
] as const;

export const RISK_POLICY = {
  low: 'auto',
  medium: 'approval',
  high: 'block',
} as const;

// Why a commit was refused. The desk renders these; the model never invents one.
// Order here mirrors the order the guard checks them in.
export const COMMIT_REJECTIONS = [
  'proposal_not_found',
  'plan_not_found',
  'plan_not_in_proposal',
  'already_committed',
  'validation_failed',
  'snapshot_mismatch',
  'stale_snapshot',
  'approval_required',
  'commit_blocked',
] as const;

export type CommitRejection = (typeof COMMIT_REJECTIONS)[number];
