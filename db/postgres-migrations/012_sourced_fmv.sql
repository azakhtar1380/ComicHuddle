CREATE TABLE gcd.comichuddle_issue_refs(id bigint PRIMARY KEY,gcd_issue_id integer);
CREATE FUNCTION gcd.check_comichuddle_issue_ref() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM gcd.comichuddle_directory WHERE id=NEW.id AND gcd_id IS NOT DISTINCT FROM NEW.gcd_issue_id) THEN RAISE EXCEPTION 'FMV must reference an existing exact directory issue'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER comichuddle_issue_ref_valid BEFORE INSERT OR UPDATE ON gcd.comichuddle_issue_refs FOR EACH ROW EXECUTE FUNCTION gcd.check_comichuddle_issue_ref();
CREATE TABLE gcd.sales_comps(
 id text PRIMARY KEY,issue_id bigint NOT NULL REFERENCES gcd.comichuddle_issue_refs(id),
 source text NOT NULL CHECK(source IN ('authorized_ebay','licensed_feed','platform')),
 source_reference text NOT NULL,source_url text NOT NULL CHECK(source_url LIKE 'https://%'),
 mode text NOT NULL CHECK(mode IN ('Raw','CGC','CBCS')),grade text NOT NULL,label text NOT NULL CHECK(label IN ('Raw','Universal')),printing text NOT NULL,
 sold_at timestamptz NOT NULL,price_cents bigint NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 best_offer_accepted boolean NOT NULL DEFAULT false,actual_price_confirmed boolean NOT NULL DEFAULT true,
 rights_reference text NOT NULL CHECK(length(rights_reference)>=5),rights_expires_at timestamptz NOT NULL,
 verified boolean NOT NULL DEFAULT false,imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_reference,issue_id,mode,grade,label,printing)
);
CREATE INDEX sales_comps_issue_grade_date ON gcd.sales_comps(issue_id,mode,grade,label,printing,sold_at DESC) WHERE verified;
CREATE TABLE gcd.fmv_records(
 issue_id bigint NOT NULL REFERENCES gcd.comichuddle_issue_refs(id),mode text NOT NULL CHECK(mode IN ('Raw','CGC','CBCS')),grade text NOT NULL,label text NOT NULL CHECK(label IN ('Raw','Universal')),printing text NOT NULL,
 fmv_price numeric(12,2) NOT NULL CHECK(fmv_price>0),low_price numeric(12,2) NOT NULL,high_price numeric(12,2) NOT NULL,
 last_updated timestamptz NOT NULL,sample_size integer NOT NULL CHECK(sample_size>=3),window_days integer NOT NULL CHECK(window_days BETWEEN 1 AND 366),
 source_name text NOT NULL,source_url text NOT NULL,valid_until timestamptz NOT NULL,method text NOT NULL DEFAULT 'ROLLING_MEDIAN_IQR',
 PRIMARY KEY(issue_id,mode,grade,label,printing),CHECK(low_price<=fmv_price AND fmv_price<=high_price),CHECK(valid_until>last_updated)
);
CREATE INDEX fmv_records_fresh ON gcd.fmv_records(valid_until,last_updated DESC);
CREATE TABLE gcd.fmv_sync_state(id text PRIMARY KEY,next_issue_id bigint NOT NULL DEFAULT -1,last_completed_at timestamptz,last_error text,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO gcd.fmv_sync_state(id) VALUES('weekly') ON CONFLICT DO NOTHING;
