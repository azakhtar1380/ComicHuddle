SET LOCAL search_path TO ch_web, public;
CREATE TABLE photo_bytes (
  key text PRIMARY KEY,
  body bytea NOT NULL CHECK(octet_length(body) <= 4194304),
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Original permission/guard expressions retain JSON paths. These functions use
-- PostgreSQL JSONB and expose only the scalar values/array types they require.
CREATE FUNCTION json_extract(document text, path text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT document::jsonb #>> string_to_array(substr(path, 3), '.');
$$;
CREATE FUNCTION json_array_length(document text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT jsonb_array_length(document::jsonb); $$;
CREATE FUNCTION json_each(document text, path text DEFAULT '$')
RETURNS TABLE(key bigint, value text, type text)
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT ordinality - 1,
    CASE jsonb_typeof(element) WHEN 'string' THEN element #>> '{}' ELSE element::text END,
    CASE jsonb_typeof(element) WHEN 'string' THEN 'text' ELSE jsonb_typeof(element) END
  FROM jsonb_array_elements(CASE WHEN path='$' THEN document::jsonb
    ELSE document::jsonb #> string_to_array(substr(path,3),'.') END) WITH ORDINALITY AS items(element,ordinality);
$$;
CREATE FUNCTION parse_iso_timestamp(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE STRICT AS $$
BEGIN
  IF value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NULL;
END;
$$;
