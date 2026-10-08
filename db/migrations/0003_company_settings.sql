-- 0003: the company's own settings, one row per workspace schema (ADR 011).
-- No row means the defaults in src/shared/contracts/settings.ts.
CREATE TABLE IF NOT EXISTS company_setting (
    id TEXT PRIMARY KEY DEFAULT 'company' CHECK (id = 'company'),
    name TEXT NOT NULL,
    day_start TEXT NOT NULL CHECK (day_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    day_end TEXT NOT NULL CHECK (day_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    default_profile TEXT NOT NULL CHECK (default_profile IN ('sla_first', 'minimal_disruption')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
