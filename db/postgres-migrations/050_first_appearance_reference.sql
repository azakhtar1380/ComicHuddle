-- Additive: allow hand-checked first appearances (lib/first-appearance-reference.ts) as a third source.
-- They outrank Metron and Wikidata; conflicting rows for the same character are hidden (suppressed), never deleted.
ALTER TABLE ch_web.character_first_appearances DROP CONSTRAINT IF EXISTS character_first_appearances_source_check;
ALTER TABLE ch_web.character_first_appearances ADD CONSTRAINT character_first_appearances_source_check CHECK (source IN ('metron','wikidata','reference'));
