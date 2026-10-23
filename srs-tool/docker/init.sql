-- PostgreSQL init script
-- Runs once when the postgres container starts for the first time

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable Row Level Security by default for all user-scoped tables
-- (RLS policies will be added per table in migrations)
