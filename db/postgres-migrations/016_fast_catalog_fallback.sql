-- Keep interactive search fast during an incomplete native snapshot import.
-- This read-only GCD namespace view contains the existing sourced directory;
-- it is used only until the native series table has usable rows.
CREATE VIEW gcd.comichuddle_legacy_directory AS
 SELECT c.id,c.gcd_id,c.metron_id,c.title,c.number,c.publisher,c.year,c.era,c.kind,c.search_text,c.data,
 CASE WHEN c.data LIKE '%/covers/%' THEN 0 WHEN EXISTS(SELECT 1 FROM gcd.comichuddle_cover_references r WHERE r.issue_id=c.id AND r.status='active') THEN 1 ELSE 2 END AS cover_rank,
 c.fetched_at,c.raw_metadata FROM ch_web.catalog_issues c;
