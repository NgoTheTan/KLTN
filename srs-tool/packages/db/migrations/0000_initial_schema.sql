-- Migration: 0000_initial_schema.sql
-- Initializes PostgreSQL extensions, 19 entities, indexes, and Row Level Security (RLS)

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    plan TEXT NOT NULL DEFAULT 'standard',
    locale TEXT NOT NULL DEFAULT 'vi',
    daily_limit_tokens INTEGER NOT NULL DEFAULT 100000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Projects
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    platforms JSONB NOT NULL,
    output_language TEXT NOT NULL DEFAULT 'vi',
    constraints JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects(owner_id);

-- 4. Documents
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    filename TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents(project_id);

-- 5. Segments
CREATE TABLE IF NOT EXISTS segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    locator JSONB DEFAULT '{}'::jsonb,
    language TEXT NOT NULL DEFAULT 'vi',
    coverage_status TEXT NOT NULL DEFAULT 'unmapped',
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS segments_project_idx ON segments(project_id);
CREATE INDEX IF NOT EXISTS segments_doc_idx ON segments(document_id);
CREATE INDEX IF NOT EXISTS segments_coverage_idx ON segments(coverage_status);

-- 6. Requirements
CREATE TABLE IF NOT EXISTS requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    platforms JSONB NOT NULL,
    ears_pattern TEXT NOT NULL,
    statement TEXT NOT NULL,
    statement_original TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'vi',
    rationale TEXT,
    acceptance_criteria TEXT,
    verification_method TEXT NOT NULL DEFAULT 'test',
    priority TEXT NOT NULL DEFAULT 'should',
    metric JSONB,
    is_asr BOOLEAN NOT NULL DEFAULT FALSE,
    origin TEXT NOT NULL DEFAULT 'explicit',
    status TEXT NOT NULL DEFAULT 'candidate',
    quality_score INTEGER NOT NULL DEFAULT 100,
    issues JSONB DEFAULT '[]'::jsonb,
    resolved_by TEXT NOT NULL DEFAULT 'rule',
    confidence REAL NOT NULL DEFAULT 1.0,
    embedding VECTOR(384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS requirements_project_idx ON requirements(project_id);
CREATE INDEX IF NOT EXISTS requirements_code_idx ON requirements(code);
CREATE INDEX IF NOT EXISTS requirements_status_idx ON requirements(status);
CREATE INDEX IF NOT EXISTS requirements_type_idx ON requirements(type);

-- 7. Requirement Versions
CREATE TABLE IF NOT EXISTS requirement_versions (
    requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    changed_by TEXT NOT NULL,
    run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (requirement_id, version)
);

-- 8. Requirement Sources
CREATE TABLE IF NOT EXISTS requirement_sources (
    requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    quote TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (requirement_id, segment_id)
);

-- 9. Issues
CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requirement_id UUID REFERENCES requirements(id) ON DELETE CASCADE,
    segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    status TEXT NOT NULL DEFAULT 'open',
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS issues_project_idx ON issues(project_id);

-- 10. Questions
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    options JSONB DEFAULT '[]'::jsonb,
    proposed_value TEXT,
    answer TEXT,
    answer_segment_id UUID REFERENCES segments(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS questions_project_idx ON questions(project_id);

-- 11. Glossary Terms
CREATE TABLE IF NOT EXISTS glossary_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    term_vi TEXT NOT NULL,
    term_en TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS glossary_project_idx ON glossary_terms(project_id);

-- 12. Architecture Models
CREATE TABLE IF NOT EXISTS arch_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    language TEXT NOT NULL DEFAULT 'vi',
    body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS arch_models_project_idx ON arch_models(project_id);

-- 13. Diagrams
CREATE TABLE IF NOT EXISTS diagrams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES arch_models(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'model',
    puml TEXT NOT NULL,
    svg_s3_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diagrams_model_idx ON diagrams(model_id);

-- 14. Tech Recommendations
CREATE TABLE IF NOT EXISTS tech_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES arch_models(id) ON DELETE CASCADE,
    layer TEXT NOT NULL,
    choice TEXT NOT NULL,
    alternatives JSONB DEFAULT '[]'::jsonb,
    rationale TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tech_recs_model_idx ON tech_recommendations(model_id);

-- 15. Runs
CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'pipeline',
    mode TEXT NOT NULL DEFAULT 'standard',
    from_stage INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs(project_id);

-- 16. Usage Ledger
CREATE TABLE IF NOT EXISTS usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id UUID,
    kind TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT 'none',
    cost_usd REAL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_ledger(user_id);
CREATE INDEX IF NOT EXISTS usage_run_idx ON usage_ledger(run_id);

-- 17. Exports
CREATE TABLE IF NOT EXISTS exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    formats JSONB NOT NULL,
    s3_key TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exports_project_idx ON exports(project_id);

-- 18. Agent Sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_sessions_project_idx ON agent_sessions(project_id);

-- 19. Agent Patches
CREATE TABLE IF NOT EXISTS agent_patches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sessionId UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES arch_models(id) ON DELETE CASCADE,
    patch JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_patches_session_idx ON agent_patches(sessionId);
CREATE INDEX IF NOT EXISTS agent_patches_model_idx ON agent_patches(model_id);

-- 20. Decision Log
CREATE TABLE IF NOT EXISTS decision_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    stage INTEGER NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id UUID,
    tier TEXT NOT NULL,
    confidence REAL NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'decided',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS decision_log_run_idx ON decision_log(run_id);

-- 21. Row Level Security (RLS) Configuration
-- Enable RLS on all tenant/project-scoped tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirement_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE glossary_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE arch_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_patches ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
-- If 'app.current_project_id' is set, restrict access to that project.
-- If not set (e.g. administrative tasks / local development), permit all rows.

DO $$
BEGIN
    -- Projects Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'project_isolation_policy' AND tablename = 'projects') THEN
        CREATE POLICY project_isolation_policy ON projects
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Documents Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'documents_isolation_policy' AND tablename = 'documents') THEN
        CREATE POLICY documents_isolation_policy ON documents
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Segments Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'segments_isolation_policy' AND tablename = 'segments') THEN
        CREATE POLICY segments_isolation_policy ON segments
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Requirements Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'requirements_isolation_policy' AND tablename = 'requirements') THEN
        CREATE POLICY requirements_isolation_policy ON requirements
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Issues Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'issues_isolation_policy' AND tablename = 'issues') THEN
        CREATE POLICY issues_isolation_policy ON issues
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Questions Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'questions_isolation_policy' AND tablename = 'questions') THEN
        CREATE POLICY questions_isolation_policy ON questions
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Arch Models Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'arch_models_isolation_policy' AND tablename = 'arch_models') THEN
        CREATE POLICY arch_models_isolation_policy ON arch_models
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;

    -- Runs Policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'runs_isolation_policy' AND tablename = 'runs') THEN
        CREATE POLICY runs_isolation_policy ON runs
            FOR ALL
            USING (
                NULLIF(current_setting('app.current_project_id', true), '') IS NULL
                OR project_id = NULLIF(current_setting('app.current_project_id', true), '')::UUID
            );
    END IF;
END $$;
