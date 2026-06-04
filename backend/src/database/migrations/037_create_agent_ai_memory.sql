-- Agent AI memory for iterative learning from prior Q&A and user feedback

CREATE TABLE IF NOT EXISTS agent_ai_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question TEXT NOT NULL,
  answer TEXT,
  report TEXT,
  insights TEXT,
  comparison TEXT,
  direct_used BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rating SMALLINT,
  feedback TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_ai_memory_created_at
  ON agent_ai_memory (created_at DESC);

