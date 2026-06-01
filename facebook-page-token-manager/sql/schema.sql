CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pages (
  page_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_name TEXT NOT NULL,
  category TEXT,
  page_access_token TEXT NOT NULL,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_refresh_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(page_id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL UNIQUE,
  token_type TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  is_expiring BOOLEAN NOT NULL DEFAULT FALSE,
  last_checked_at TIMESTAMPTZ,
  warning_message TEXT,
  debug_type TEXT,
  app_id TEXT,
  external_user_id TEXT,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (token_type <> '')
);

CREATE INDEX IF NOT EXISTS tokens_expiry_idx ON tokens (expires_at);
CREATE INDEX IF NOT EXISTS tokens_warning_idx ON tokens (is_expiring, is_valid);
