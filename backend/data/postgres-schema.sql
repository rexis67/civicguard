-- CivicGuard PostgreSQL Production Schema
-- Compatible with PostgreSQL 14+ (Supabase, Neon, AWS RDS, Render Postgres)

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('citizen', 'authority')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_token_hash VARCHAR(255),
    verification_token_expires_at BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token_hash);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens ON password_reset_tokens(token_hash);

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    category VARCHAR(80) NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    analysis_status VARCHAR(64) NOT NULL DEFAULT 'pending',
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    duplicate_of UUID REFERENCES reports(id) ON DELETE SET NULL,
    report_count INTEGER NOT NULL DEFAULT 1,
    tracking_code VARCHAR(32) UNIQUE,
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_category_created ON reports(category, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_coordinates ON reports(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_reports_analysis_status ON reports(analysis_status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_tracking_code ON reports(tracking_code);

CREATE TABLE IF NOT EXISTS report_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_email VARCHAR(255) NOT NULL,
    previous_status VARCHAR(64),
    new_status VARCHAR(64) NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_audits_report ON report_audits(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    status VARCHAR(64) NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_timeline_report ON report_timeline(report_id, created_at ASC);

CREATE TABLE IF NOT EXISTS report_confirmations (
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    device_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, device_hash)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
