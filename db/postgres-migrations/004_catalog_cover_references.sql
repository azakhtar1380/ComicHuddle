-- Artwork references are independent of immutable bibliography imports.
-- Reduced thumbnails identify editions; the metadata CC license does not
-- license artwork. No image binaries or private user photos are stored here.
CREATE TABLE ch_web.catalog_cover_references (
  issue_id bigint PRIMARY KEY REFERENCES ch_web.catalog_issues(id) ON DELETE CASCADE,
  gcd_id bigint NOT NULL CHECK (gcd_id > 0 AND gcd_id <= 2147483647),
  image_url text NOT NULL,
  source_url text NOT NULL,
  source_page text NOT NULL,
  edition_descriptor text NOT NULL,
  attribution text NOT NULL,
  image_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(image_metadata) = 'object'),
  display_basis text NOT NULL DEFAULT 'identification_reference'
    CHECK (display_basis = 'identification_reference'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (issue_id = 4000000000 + gcd_id),
  CHECK (image_url ~ '^https://files[0-9]+\.comics\.org/+img/gcd/covers_by_id/[0-9]+/w400/[0-9]+\.jpg$'),
  CHECK (source_url = 'https://www.comics.org/issue/' || gcd_id::text || '/')
);
CREATE INDEX catalog_cover_references_active ON ch_web.catalog_cover_references(issue_id) WHERE status = 'active';
