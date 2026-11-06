-- COD (Commercial Documents app): when a user was first shown the user guide. NULL = not yet; the app then points the user to the
-- guide once, at their first sign-in, and stores the time so later sign-ins (on any device) are not interrupted.
-- Everyone starts NULL on purpose: the guide is new to all current users too, so each sees the prompt once.

ALTER TABLE users ADD COLUMN IF NOT EXISTS commdocs_guide_seen_at TIMESTAMPTZ;
