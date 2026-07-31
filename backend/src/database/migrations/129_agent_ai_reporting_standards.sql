-- Standing reporting rules for the KLIP Agent AI: quantities in MT, no decimals anywhere.
--
-- These are enforced in code for the deterministic answers (resolveQtyUnit / fmtQty round to whole
-- MT). They are recorded here as well so the Claude-generated answers follow the same rules, since
-- those are shaped by the lessons block rather than by formatting helpers.

-- The earlier learned preference told the agent to append the Kg equivalent in brackets, which is
-- now unwanted clutter. Retire it rather than deleting, so the audit trail survives.
UPDATE agent_ai_lessons
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE kind = 'preference'
  AND lower(lesson) LIKE '%showing kg in brackets%';

INSERT INTO agent_ai_lessons (learned_from_user_id, kind, lesson)
VALUES
  (NULL, 'preference',
   'Always report quantities in MT (metric tonnes), converting from the Kg stored in KLIP. Never report Kg unless the user explicitly asks for Kg, and do not add a Kg equivalent in brackets.'),
  (NULL, 'preference',
   'Never write decimal places in any number. Round quantities, amounts, money, percentages, day counts and averages to whole numbers.')
ON CONFLICT (kind, lower(btrim(lesson))) DO UPDATE
  SET is_active = true, updated_at = CURRENT_TIMESTAMP;
