-- Migration 088: vessel_patterns — cache suggested loading port for AI planner

ALTER TABLE vessel_patterns
  ADD COLUMN IF NOT EXISTS suggested_loading_port VARCHAR(255);
