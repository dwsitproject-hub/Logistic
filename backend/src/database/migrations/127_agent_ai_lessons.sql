-- KLIP Agent AI: durable "lessons" so the agent improves from use instead of only logging Q&A.
--
-- Why a separate table from agent_ai_memory:
--   agent_ai_memory is an episodic log — the exact answer given at a point in time, numbers and
--   all. Those numbers go stale the moment SAP posts a GR or a formula is corrected, which is why
--   the prompt forbids treating them as a data source. Replaying them as "learning" makes the
--   agent argue with itself about discrepancies.
--   agent_ai_lessons stores the opposite: short, durable, NUMBER-FREE guidance about HOW to
--   answer — units to use, what a term means here, and corrections a user has already made.
--   That is what can safely be replayed into every future answer.

CREATE TABLE IF NOT EXISTS agent_ai_lessons (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- NULL = applies to everyone. Set = that user's own preference.
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,

  -- preference: output shaping the user asked for (units, brevity, format)
  -- definition: what a term means in KLIP (area names, metric definitions)
  -- correction: something the agent got wrong and must not repeat
  kind varchar(20) NOT NULL CHECK (kind IN ('preference', 'definition', 'correction')),

  -- One short imperative sentence. Must not contain figures that can go stale.
  lesson text NOT NULL,

  -- The answer that triggered it, for audit / review.
  source_memory_id uuid REFERENCES agent_ai_memory(id) ON DELETE SET NULL,

  -- Usage tracking, so noisy or never-relevant lessons can be found and retired.
  times_applied integer NOT NULL DEFAULT 0,
  last_applied_at timestamp,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

-- One lesson per (owner, kind, text). COALESCE because NULL user_id rows are "distinct" to a
-- plain unique index, which would let the same global lesson be inserted repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_ai_lessons_unique
  ON agent_ai_lessons (
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    lower(btrim(lesson))
  );

-- Retrieval path: active lessons for this user plus the global ones, newest first.
CREATE INDEX IF NOT EXISTS idx_agent_ai_lessons_lookup
  ON agent_ai_lessons (is_active, user_id, updated_at DESC);

DROP TRIGGER IF EXISTS update_agent_ai_lessons_updated_at ON agent_ai_lessons;
CREATE TRIGGER update_agent_ai_lessons_updated_at
  BEFORE UPDATE ON agent_ai_lessons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Episodic recall currently scores the newest 200 rows in JS and ignores rating entirely, so a
-- thumbs-down answer is replayed as an example just like a good one. These support rating-aware,
-- bounded retrieval instead.
CREATE INDEX IF NOT EXISTS idx_agent_ai_memory_rating_created
  ON agent_ai_memory (rating, created_at DESC);

-- Seed the two things this deployment already established, as global definitions. Without these
-- the agent has to be re-taught them by every user on every fresh conversation.
INSERT INTO agent_ai_lessons (user_id, kind, lesson)
VALUES
  (NULL, 'definition',
   'When the user names an area or site (for example Bontang, Karawang, Tanjung Pura), they mean the Group Plant field from the Master Plant List - the same dimension Contracts, Shipments, Trucking, Contract Performance, Shipping Performance and Oil Loss filter on.'),
  (NULL, 'definition',
   'Contract performance means delivery timeliness against the delivery window (late versus on track), as shown on the Contract Performance page - not just contracted versus delivered quantity.'),
  (NULL, 'correction',
   'Never answer a question about one product, area or period with company-wide totals presented as if they were that scope. Say plainly when a figure is company-wide.'),
  (NULL, 'correction',
   'Never ask the user to run a query, pull an export, or fetch data so you can then answer. Answer with the data you have and name at most one genuinely missing breakdown.')
ON CONFLICT DO NOTHING;
