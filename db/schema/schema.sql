-- Dispatch Coordinator Agent v0.4
-- Database Schema Definition (RDS PostgreSQL 16)
-- Frozen version for Dispatch Coordinator Agent

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PEOPLE MODULE
-- ============================================================================

-- app_user: User accounts linked to Cognito sub
CREATE TABLE IF NOT EXISTS app_user (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    cognito_sub TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('technician', 'desk', 'admin')),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- technician: Technician profiles and constraints
CREATE TABLE IF NOT EXISTS technician (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    tier INT NOT NULL CHECK (tier BETWEEN 1 AND 4), -- 1: Apprentice, 2: BCA installer, 3: Specialist, 4: LEW
    home_region TEXT NOT NULL, -- e.g. 'East', 'West', 'North', 'Central', 'North-East'
    max_minutes_day INT NOT NULL DEFAULT 480, -- Daily limit (8 hours = 480 mins)
    accepts_ot BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- technician_cert: Certifications held by technicians
CREATE TABLE IF NOT EXISTS technician_cert (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
    cert_type TEXT NOT NULL, -- e.g. 'WSH_PASS', 'BCA_STRUCTURAL', 'NITEC_HVAC', 'NEA_R32', 'EMA_LEW'
    brand TEXT, -- Optional brand familiarity e.g. 'Daikin', 'Mitsubishi', 'Panasonic'
    issued_at DATE NOT NULL,
    expires_at DATE, -- NULL if non-expiring
    is_legal_gate BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- shift: Daily attendance and shift status per technician
CREATE TABLE IF NOT EXISTS shift (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
    shift_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'clocked_in', 'mc', 'no_show', 'completed')),
    clock_in_at TIMESTAMPTZ,
    clock_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (technician_id, shift_date)
);

-- ============================================================================
-- 2. CATALOG MODULE
-- ============================================================================

-- customer: Customer directory (Phone is the primary intake lookup key)
CREATE TABLE IF NOT EXISTS customer (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    company_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- site: Customer locations and physical site attributes
CREATE TABLE IF NOT EXISTS site (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    postal_code VARCHAR(6) NOT NULL,
    region TEXT NOT NULL,
    estate_cluster TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    unit_no TEXT NOT NULL, -- Masked until en_route status
    last_technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    preferred_technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    access_flags TEXT[] DEFAULT '{}', -- e.g. {'LEDGE_REQUIRED', 'HIGH_RISER'}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- site_memory: Historical notes captured at job close-out
CREATE TABLE IF NOT EXISTS site_memory (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    site_id TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    job_id TEXT, -- Associated job
    technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    note_raw TEXT NOT NULL, -- Display-only untrusted text
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- job_type: Master service catalog entries
CREATE TABLE IF NOT EXISTS job_type (
    id TEXT PRIMARY KEY, -- e.g. 'GENERAL_SERVICE', 'WATER_LEAK', 'REFRIGERANT_LEAK', 'OVERHAUL', 'INSTALL_OUTDOOR', 'VRV_SIGN_OFF'
    name TEXT NOT NULL,
    min_tier INT NOT NULL CHECK (min_tier BETWEEN 1 AND 4),
    difficulty INT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    default_minutes INT NOT NULL DEFAULT 60,
    sla_hours INT, -- SLA target in hours (e.g. 2, 4, 24, 72)
    brand_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- job_type_cert: Certificates required by catalog job types
CREATE TABLE IF NOT EXISTS job_type_cert (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_type_id TEXT NOT NULL REFERENCES job_type(id) ON DELETE CASCADE,
    cert_type TEXT NOT NULL,
    brand_required BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (job_type_id, cert_type)
);

-- recurrence: Recurring maintenance contracts (RRULE based)
CREATE TABLE IF NOT EXISTS recurrence (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    site_id TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    rrule TEXT NOT NULL,
    cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    materialised_to DATE NOT NULL,
    holiday_policy TEXT NOT NULL DEFAULT 'skip' CHECK (holiday_policy IN ('skip', 'next_working_day', 'prior_working_day')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. DISPATCH MODULE
-- ============================================================================

-- job: Core job entity and status machine
CREATE TABLE IF NOT EXISTS job (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
    site_id TEXT NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
    job_type_id TEXT NOT NULL REFERENCES job_type(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'received' CHECK (
        status IN (
            'received', 'unassigned', 'offered', 'assigned',
            'en_route', 'on_site', 'done',
            'cancelled', 'blocked_access', 'needs_skill', 'rescheduled', 'no_candidates'
        )
    ),
    priority TEXT NOT NULL DEFAULT 'on_demand' CHECK (priority IN ('urgent', 'on_demand', 'when_available', 'callback', 'quote')),
    window_type TEXT NOT NULL DEFAULT 'loose' CHECK (window_type IN ('tight', 'loose')),
    scheduled_date DATE NOT NULL,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    note_raw TEXT NOT NULL DEFAULT '',
    intake_parsed JSONB,
    required_crew_size INT NOT NULL DEFAULT 1 CHECK (required_crew_size BETWEEN 1 AND 4),
    board_version_at_rank INT NOT NULL DEFAULT 1,
    confidence_score NUMERIC(3,2) DEFAULT 1.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- job_requirement: Frozen snapshot of requirements at job creation time
CREATE TABLE IF NOT EXISTS job_requirement (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    min_tier INT NOT NULL CHECK (min_tier BETWEEN 1 AND 4),
    required_certs TEXT[] DEFAULT '{}',
    brand_required TEXT,
    required_crew_size INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- assignment: Technician offers and commitments
CREATE TABLE IF NOT EXISTS assignment (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'reassigned', 'cancelled')),
    snapshot_id TEXT NOT NULL,
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, -- 10 minute offer window
    accepted_at TIMESTAMPTZ,
    score_breakdown JSONB NOT NULL,
    decision_log_id TEXT
);

-- status_event: Append-only job status history log (Dispatch module writer only)
CREATE TABLE IF NOT EXISTS status_event (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. LOCATION MODULE
-- ============================================================================

-- travel_matrix: Matrix of travel times between estate clusters
CREATE TABLE IF NOT EXISTS travel_matrix (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    from_cluster TEXT NOT NULL,
    to_cluster TEXT NOT NULL,
    minutes INT NOT NULL,
    peak_minutes INT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('fixture', 'seeded', 'calculated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_cluster, to_cluster)
);

-- ============================================================================
-- 5. AGENT MODULE
-- ============================================================================

-- board_snapshot: Versioned state snapshots of the dispatch board
CREATE TABLE IF NOT EXISTS board_snapshot (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    version INT NOT NULL UNIQUE,
    snapshot_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- decision_log: Append-only log of agent reasoning traces and tool executions
CREATE TABLE IF NOT EXISTS decision_log (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_type TEXT NOT NULL,
    playbook TEXT NOT NULL,
    tool_calls JSONB NOT NULL,
    summary TEXT NOT NULL,
    approval_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- approval: Desk user human-in-the-loop approval cards
CREATE TABLE IF NOT EXISTS approval (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    trigger_reason TEXT NOT NULL,
    recommendation JSONB NOT NULL,
    who_would_be_late JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    actioned_by TEXT REFERENCES app_user(id),
    actioned_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actioned_at TIMESTAMPTZ
);

-- intake_message: Active customer conversation threads
CREATE TABLE IF NOT EXISTS intake_message (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    phone TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_raw TEXT NOT NULL,
    question_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'job_created', 'escalated_to_desk')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- dispatch_policy: Policy thresholds for auto vs HITL escalation
CREATE TABLE IF NOT EXISTS dispatch_policy (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_trigger TEXT NOT NULL UNIQUE,
    auto_action BOOLEAN NOT NULL DEFAULT TRUE,
    requires_approval_if_tight BOOLEAN NOT NULL DEFAULT TRUE,
    max_batch_size INT NOT NULL DEFAULT 3,
    description TEXT NOT NULL
);

-- ============================================================================
-- HELPER FUNCTIONS AND INDEXES
-- ============================================================================

-- Function: cert_valid_on
-- Checks if a technician holds a valid, unexpired certificate of a given type on a specific date
CREATE OR REPLACE FUNCTION cert_valid_on(
    p_tech_id TEXT,
    p_cert_type TEXT,
    p_job_date DATE
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM technician_cert
        WHERE technician_id = p_tech_id
          AND cert_type = p_cert_type
          AND issued_at <= p_job_date
          AND (expires_at IS NULL OR expires_at >= p_job_date)
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer(phone);
CREATE INDEX IF NOT EXISTS idx_site_postal ON site(postal_code);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status);
CREATE INDEX IF NOT EXISTS idx_job_scheduled_date ON job(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_assignment_tech_id ON assignment(technician_id);
CREATE INDEX IF NOT EXISTS idx_assignment_job_id ON assignment(job_id);
CREATE INDEX IF NOT EXISTS idx_shift_tech_date ON shift(technician_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_status_event_job_id ON status_event(job_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_created ON decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval(status);
