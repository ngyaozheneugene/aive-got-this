-- Dispatch Coordinator v1.1
-- Postgres 16. Product database on the Lightsail Compose box.
-- People / catalog / dispatch from v0.4 are kept. Control-tower tables are additive.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. PEOPLE
-- ============================================================================

-- Demo logins, not Cognito. cognito_sub is nullable leftover from v0.4.
CREATE TABLE IF NOT EXISTS app_user (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    demo_login TEXT UNIQUE,
    cognito_sub TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('technician', 'desk', 'admin')),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technician (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    tier INT NOT NULL CHECK (tier BETWEEN 1 AND 4),
    home_region TEXT NOT NULL,
    current_cluster TEXT,
    max_minutes_day INT NOT NULL DEFAULT 480,
    accepts_ot BOOLEAN NOT NULL DEFAULT FALSE,
    parts TEXT[] NOT NULL DEFAULT '{}',
    tools TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technician_cert (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
    cert_type TEXT NOT NULL,
    brand TEXT,
    issued_at DATE NOT NULL,
    expires_at DATE,
    is_legal_gate BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
-- 2. CATALOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    company_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    customer_id TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    postal_code VARCHAR(6) NOT NULL,
    region TEXT NOT NULL,
    estate_cluster TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    unit_no TEXT NOT NULL,
    last_technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    preferred_technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    access_flags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_memory (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    site_id TEXT NOT NULL REFERENCES site(id) ON DELETE CASCADE,
    job_id TEXT,
    technician_id TEXT REFERENCES technician(id) ON DELETE SET NULL,
    note_raw TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_type (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    min_tier INT NOT NULL CHECK (min_tier BETWEEN 1 AND 4),
    difficulty INT NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    default_minutes INT NOT NULL DEFAULT 60,
    sla_hours INT,
    brand_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_type_cert (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_type_id TEXT NOT NULL REFERENCES job_type(id) ON DELETE CASCADE,
    cert_type TEXT NOT NULL,
    brand_required BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (job_type_id, cert_type)
);

-- P2. Table may exist unused. Do not materialise RRULE in v1.
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
-- 3. DISPATCH
-- ============================================================================

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
    lock_state TEXT NOT NULL DEFAULT 'none' CHECK (lock_state IN ('none', 'promised', 'in_progress')),
    scheduled_date DATE NOT NULL,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    duration_minutes INT NOT NULL DEFAULT 60,
    parts_required TEXT[] NOT NULL DEFAULT '{}',
    tools_required TEXT[] NOT NULL DEFAULT '{}',
    note_raw TEXT NOT NULL DEFAULT '',
    intake_parsed JSONB,
    required_crew_size INT NOT NULL DEFAULT 1 CHECK (required_crew_size BETWEEN 1 AND 4),
    board_version_at_rank INT NOT NULL DEFAULT 1,
    confidence_score NUMERIC(3,2) DEFAULT 1.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_requirement (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    min_tier INT NOT NULL CHECK (min_tier BETWEEN 1 AND 4),
    required_certs TEXT[] DEFAULT '{}',
    brand_required TEXT,
    required_crew_size INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Committed day slots. Offer/accept expiry is P1 technician flow; expires_at is nullable.
CREATE TABLE IF NOT EXISTS assignment (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id TEXT NOT NULL REFERENCES job(id) ON DELETE CASCADE,
    technician_id TEXT NOT NULL REFERENCES technician(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'expired', 'reassigned', 'cancelled')),
    snapshot_id TEXT NOT NULL,
    window_start TIMESTAMPTZ,
    window_end TIMESTAMPTZ,
    travel_before_minutes INT,
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_log_id TEXT
);

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
-- 4. LOCATION
-- ============================================================================

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
-- 5. CONTROL TOWER (events, plans, versions, audit)
-- ============================================================================

CREATE TABLE IF NOT EXISTS board_snapshot (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    version INT NOT NULL UNIQUE,
    source_snapshot_id TEXT,
    trigger_event_id TEXT,
    snapshot_data JSONB NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    committed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_event (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type TEXT NOT NULL CHECK (type IN ('urgent_job', 'technician_unavailable', 'job_overrun')),
    raw_text TEXT NOT NULL DEFAULT '',
    normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_snapshot_id TEXT,
    affected_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN (
        'RECEIVED', 'VALIDATED', 'PLANNING', 'PROPOSAL_READY',
        'AWAITING_APPROVAL', 'COMMITTED',
        'INVALID', 'INFEASIBLE', 'REJECTED', 'SUPERSEDED', 'FAILED'
    )),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proposal (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_id TEXT NOT NULL REFERENCES operational_event(id) ON DELETE CASCADE,
    source_snapshot_id TEXT NOT NULL,
    recommended_plan_id TEXT,
    risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),
    autonomy_mode TEXT NOT NULL DEFAULT 'approval' CHECK (autonomy_mode IN ('auto', 'approval', 'block')),
    status TEXT NOT NULL DEFAULT 'GENERATING' CHECK (status IN (
        'GENERATING', 'VALIDATED', 'RECOMMENDED', 'APPROVED',
        'COMMITTED', 'EXPIRED', 'SUPERSEDED', 'REJECTED'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidate_plan (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    proposal_id TEXT NOT NULL REFERENCES proposal(id) ON DELETE CASCADE,
    source_snapshot_id TEXT NOT NULL,
    profile TEXT NOT NULL CHECK (profile IN ('sla_first', 'minimal_disruption')),
    assignments JSONB NOT NULL DEFAULT '[]'::jsonb,
    change_set JSONB NOT NULL DEFAULT '[]'::jsonb,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    validations JSONB NOT NULL DEFAULT '{}'::jsonb,
    solver_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
    timed_out BOOLEAN NOT NULL DEFAULT FALSE,
    duration_ms INT,
    status TEXT NOT NULL DEFAULT 'VALIDATED' CHECK (status IN ('VALIDATED', 'REJECTED', 'RECOMMENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_log (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_id TEXT,
    event_type TEXT NOT NULL,
    playbook TEXT NOT NULL,
    sequence INT,
    stage TEXT,
    tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary TEXT NOT NULL,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    duration_ms INT,
    result TEXT,
    approval_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    proposal_id TEXT REFERENCES proposal(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL DEFAULT '',
    job_id TEXT REFERENCES job(id) ON DELETE CASCADE,
    source_snapshot_id TEXT,
    trigger_reason TEXT NOT NULL,
    recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
    who_would_be_late JSONB,
    policy_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    approved_plan_id TEXT REFERENCES candidate_plan(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    actioned_by TEXT REFERENCES app_user(id),
    actioned_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actioned_at TIMESTAMPTZ
);

-- P2 / unused. Customer paste-intake is not the P0 spine.
CREATE TABLE IF NOT EXISTS intake_message (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    phone TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_raw TEXT NOT NULL,
    question_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'job_created', 'escalated_to_desk')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_policy (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    risk TEXT NOT NULL UNIQUE CHECK (risk IN ('low', 'medium', 'high')),
    mode TEXT NOT NULL CHECK (mode IN ('auto', 'approval', 'block')),
    description TEXT NOT NULL
);

-- v0.4 leftover. Prefer risk_policy.
CREATE TABLE IF NOT EXISTS dispatch_policy (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_trigger TEXT NOT NULL UNIQUE,
    auto_action BOOLEAN NOT NULL DEFAULT TRUE,
    requires_approval_if_tight BOOLEAN NOT NULL DEFAULT TRUE,
    max_batch_size INT NOT NULL DEFAULT 3,
    description TEXT NOT NULL
);

-- ============================================================================
-- HELPERS AND INDEXES
-- ============================================================================

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

INSERT INTO risk_policy (risk, mode, description) VALUES
    ('low', 'auto', 'Same technician, no window change, no reassignment, no overtime, no safety impact'),
    ('medium', 'approval', 'Reassignment, ETA movement, overtime, or multiple jobs affected'),
    ('high', 'block', 'Missing certification, no feasible plan, excessive overtime, incomplete critical fields')
ON CONFLICT (risk) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer(phone);
CREATE INDEX IF NOT EXISTS idx_site_postal ON site(postal_code);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status);
CREATE INDEX IF NOT EXISTS idx_job_scheduled_date ON job(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_assignment_tech_id ON assignment(technician_id);
CREATE INDEX IF NOT EXISTS idx_assignment_job_id ON assignment(job_id);
CREATE INDEX IF NOT EXISTS idx_shift_tech_date ON shift(technician_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_status_event_job_id ON status_event(job_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_created ON decision_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_log_event ON decision_log(event_id);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval(status);
CREATE INDEX IF NOT EXISTS idx_approval_proposal ON approval(proposal_id);
CREATE INDEX IF NOT EXISTS idx_operational_event_status ON operational_event(status);
CREATE INDEX IF NOT EXISTS idx_proposal_event ON proposal(event_id);
CREATE INDEX IF NOT EXISTS idx_candidate_plan_proposal ON candidate_plan(proposal_id);
CREATE INDEX IF NOT EXISTS idx_app_user_demo_login ON app_user(demo_login);
