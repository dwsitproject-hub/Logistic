-- One-time e-mail links that let a user set their own password: an invitation for a new account (INVITE) or a
-- "forgot password" request (RESET). Only the SHA-256 of the token is stored, so a database read never yields a usable link.

CREATE TABLE IF NOT EXISTS user_auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('INVITE', 'RESET')),
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS user_auth_tokens_token_hash_uidx ON user_auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS user_auth_tokens_user_purpose_idx ON user_auth_tokens (user_id, purpose);
CREATE INDEX IF NOT EXISTS user_auth_tokens_expires_at_idx ON user_auth_tokens (expires_at);
