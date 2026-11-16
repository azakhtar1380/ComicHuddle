-- Additive only: profile Worlds (themes). Definitions live in lib/profile-worlds.ts.
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS world text NOT NULL DEFAULT 'classic';
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS ink text NOT NULL DEFAULT 'golden';
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS frame text NOT NULL DEFAULT 'circle';
ALTER TABLE ch_web.profile_extras ADD COLUMN IF NOT EXISTS sfx text NOT NULL DEFAULT 'POW!';
DO $$BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profile_extras_look_valid') THEN
  ALTER TABLE ch_web.profile_extras ADD CONSTRAINT profile_extras_look_valid CHECK (
   world IN ('classic','gargoyle','sunrise','newyork','cosmic','sanctum','neon','sunken','bayou','frontier')
   AND ink IN ('golden','silver','bronze','modern','noir')
   AND frame IN ('circle','burst','panel','slab')
   AND sfx IN ('POW!','ZAP!','KA-BOOM!','WHAM!','KRAK!','FWOOSH!'));
 END IF;
END$$;
