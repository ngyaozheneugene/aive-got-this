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
