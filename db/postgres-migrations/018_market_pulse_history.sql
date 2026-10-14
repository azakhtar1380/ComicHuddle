CREATE TABLE gcd.fmv_history (
 issue_id bigint NOT NULL REFERENCES gcd.comichuddle_issue_refs(id),
 mode text NOT NULL,grade text NOT NULL,label text NOT NULL,printing text NOT NULL,
 observed_on date NOT NULL, fmv_price numeric(12,2) NOT NULL CHECK(fmv_price>0),
 sample_size integer NOT NULL CHECK(sample_size>=3),source_name text NOT NULL,source_url text NOT NULL,
 PRIMARY KEY(issue_id,mode,grade,label,printing,observed_on)
);
CREATE INDEX fmv_history_issue_period ON gcd.fmv_history(issue_id,mode,grade,label,printing,observed_on DESC);
CREATE FUNCTION gcd.record_fmv_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO gcd.fmv_history(issue_id,mode,grade,label,printing,observed_on,fmv_price,sample_size,source_name,source_url)
 VALUES(NEW.issue_id,NEW.mode,NEW.grade,NEW.label,NEW.printing,(NEW.last_updated AT TIME ZONE 'UTC')::date,NEW.fmv_price,NEW.sample_size,NEW.source_name,NEW.source_url)
 ON CONFLICT(issue_id,mode,grade,label,printing,observed_on) DO UPDATE SET
 fmv_price=EXCLUDED.fmv_price,sample_size=EXCLUDED.sample_size,source_name=EXCLUDED.source_name,source_url=EXCLUDED.source_url;
 RETURN NEW;
END $$;
CREATE TRIGGER fmv_history_snapshot AFTER INSERT OR UPDATE ON gcd.fmv_records FOR EACH ROW EXECUTE FUNCTION gcd.record_fmv_history();
INSERT INTO gcd.fmv_history(issue_id,mode,grade,label,printing,observed_on,fmv_price,sample_size,source_name,source_url)
 SELECT issue_id,mode,grade,label,printing,(last_updated AT TIME ZONE 'UTC')::date,fmv_price,sample_size,source_name,source_url FROM gcd.fmv_records ON CONFLICT DO NOTHING;
