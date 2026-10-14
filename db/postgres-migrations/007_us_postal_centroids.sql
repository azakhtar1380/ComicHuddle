CREATE TABLE ch_web.us_postal_centroids (
  zip text PRIMARY KEY CHECK (zip ~ '^[0-9]{5}$'),
  city text NOT NULL,state text NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy bigint NOT NULL,source_url text NOT NULL,source_sha256 text NOT NULL,
  fetched_at timestamptz NOT NULL
);
CREATE INDEX us_postal_city_state ON ch_web.us_postal_centroids(lower(city),state,zip);
CREATE INDEX us_postal_latitude_longitude ON ch_web.us_postal_centroids(latitude,longitude);
