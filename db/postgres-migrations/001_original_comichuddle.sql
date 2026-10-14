-- Native PostgreSQL form of the original ComicHuddle application schema.
-- No sandbox data or private user records are copied.
SET LOCAL search_path TO ch_web, public;

-- 0000_giant_ricochet.sql
CREATE TABLE "collections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" text NOT NULL
);


-- 0001_third_vargas.sql
CREATE TABLE "market_values" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" bigint NOT NULL,
	"mode" text NOT NULL,
	"grade" text NOT NULL,
	"label" text NOT NULL,
	"printing" text NOT NULL,
	"fmv" double precision NOT NULL,
	"low" double precision NOT NULL,
	"high" double precision NOT NULL,
	"sales" bigint NOT NULL,
	"window_days" bigint NOT NULL,
	"updated_at" text NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL
);


-- 0002_peaceful_zaladane.sql
CREATE TABLE "blocks" (
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	PRIMARY KEY("from_id", "to_id")
);

CREATE TABLE "group_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"channel" text NOT NULL,
	"profile_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX "group_post_time" ON "group_posts" ("group_id","created_at");
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"color" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"book_id" text NOT NULL,
	"issue_id" bigint,
	"title" text NOT NULL,
	"grade" text NOT NULL,
	"description" text NOT NULL,
	"price" bigint NOT NULL,
	"shipping" bigint NOT NULL,
	"photos" text NOT NULL,
	"cert" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "memberships" (
	"group_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"joined_at" text NOT NULL,
	PRIMARY KEY("group_id", "profile_id")
);

CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX "thread_message_time" ON "messages" ("thread_id","created_at");
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"bio" text NOT NULL,
	"tagline" text NOT NULL,
	"location" text NOT NULL,
	"favorite" text NOT NULL,
	"since" bigint NOT NULL,
	"color" text NOT NULL,
	"featured" text NOT NULL,
	"visible" bigint NOT NULL,
	"dm_open" bigint NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX "profile_user_unique" ON "profiles" ("user_id");
CREATE UNIQUE INDEX "profile_handle_unique" ON "profiles" ("handle");
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE TABLE "swipes" (
	"id" text PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"give_id" text NOT NULL,
	"get_id" text NOT NULL,
	"direction" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX "swipe_owner_pair" ON "swipes" ("from_id","pair");
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"a" text NOT NULL,
	"b" text NOT NULL,
	"context" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE UNIQUE INDEX "thread_pair_unique" ON "threads" ("pair");

-- 0003_natural_ben_grimm.sql
CREATE TABLE "care_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"photos" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX "care_events_job" ON "care_events" ("job_id","created_at");
CREATE TABLE "care_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_profile_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"books" text NOT NULL,
	"services" text NOT NULL,
	"notes" text NOT NULL,
	"send_to_cgc" bigint NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"fee" bigint,
	"return_shipping" bigint,
	"cgc_estimate" bigint,
	"quote_notes" text NOT NULL,
	"quote_days" bigint,
	"quote_revision" bigint NOT NULL,
	"terms_snapshot" text NOT NULL,
	"shipping_address" text NOT NULL,
	"shipping_notes" text NOT NULL,
	"return_address" text NOT NULL,
	"incoming_carrier" text NOT NULL,
	"incoming_tracking" text NOT NULL,
	"outgoing_carrier" text NOT NULL,
	"outgoing_tracking" text NOT NULL,
	"submission_ref" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "care_jobs_requester" ON "care_jobs" ("requester_id");
CREATE INDEX "care_jobs_provider" ON "care_jobs" ("provider_profile_id");
CREATE TABLE "care_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"name" text NOT NULL,
	"bio" text NOT NULL,
	"location" text NOT NULL,
	"services" text NOT NULL,
	"prices" text NOT NULL,
	"specialties" text NOT NULL,
	"experience_since" bigint NOT NULL,
	"turnaround_min" bigint NOT NULL,
	"turnaround_max" bigint NOT NULL,
	"mail_in" bigint NOT NULL,
	"dropoff" bigint NOT NULL,
	"accepting" bigint NOT NULL,
	"visible" bigint NOT NULL,
	"submission_mode" text NOT NULL,
	"dealer_reference" text NOT NULL,
	"website" text NOT NULL,
	"logo_id" text,
	"portfolio" text NOT NULL,
	"shipping_address" text NOT NULL,
	"shipping_notes" text NOT NULL,
	"terms" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX "care_provider_profile" ON "care_providers" ("profile_id");
CREATE TABLE "care_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"author_id" text NOT NULL,
	"job_id" text,
	"rating" bigint NOT NULL,
	"quality" bigint NOT NULL,
	"communication" bigint NOT NULL,
	"timeliness" bigint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE UNIQUE INDEX "care_review_author_provider" ON "care_reviews" ("provider_id","author_id");
CREATE INDEX "care_reviews_provider" ON "care_reviews" ("provider_id");

-- 0004_high_banshee.sql
ALTER TABLE "market_values" ADD "license_reference" text DEFAULT '' NOT NULL;
ALTER TABLE "market_values" ADD "rights_expires_at" text DEFAULT '' NOT NULL;
ALTER TABLE "market_values" ADD "imported_at" text DEFAULT '' NOT NULL;

-- 0005_public_readiness.sql
ALTER TABLE "collections" ADD "revision" text DEFAULT '' NOT NULL;

ALTER TABLE "profiles" ADD "moderated" bigint DEFAULT 0 NOT NULL;

ALTER TABLE "profiles" ADD "rules_version" text DEFAULT '' NOT NULL;

ALTER TABLE "profiles" ADD "rules_accepted_at" text DEFAULT '' NOT NULL;

ALTER TABLE "care_providers" ADD "moderated" bigint DEFAULT 0 NOT NULL;

CREATE TABLE "write_limits" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "window_start" bigint NOT NULL,
  "requests" bigint NOT NULL,
  "expires_at" bigint NOT NULL
);

CREATE INDEX "write_limits_expiry" ON "write_limits" ("expires_at");

CREATE TABLE "account_restrictions" (
  "user_id" text NOT NULL,
  "scope" text NOT NULL,
  "created_at" text NOT NULL,
  PRIMARY KEY ("user_id", "scope")
);


-- 0006_marketplace_preview.sql
CREATE TABLE "auction_bids" ( "id" text PRIMARY KEY NOT NULL, "listing_id" text NOT NULL, "bidder_id" text NOT NULL, "request_id" text NOT NULL, "amount" bigint NOT NULL, "status" text NOT NULL, "sequence" bigint NOT NULL, "created_at" text NOT NULL, "retracted_at" text, "retracted_version" bigint );
CREATE UNIQUE INDEX "auction_bid_request" ON "auction_bids" ("bidder_id","request_id");
CREATE INDEX "auction_bid_listing" ON "auction_bids" ("listing_id","sequence");
CREATE INDEX "auction_bid_owner" ON "auction_bids" ("bidder_id","listing_id","sequence");
CREATE TABLE "listing_inventory" ( "seller_id" text NOT NULL, "book_id" text NOT NULL, "listing_id" text NOT NULL, PRIMARY KEY("seller_id", "book_id") );
CREATE INDEX "listing_inventory_listing" ON "listing_inventory" ("listing_id");
ALTER TABLE "listings" ADD "kind" text DEFAULT 'single' NOT NULL;
ALTER TABLE "listings" ADD "sale_type" text DEFAULT 'fixed' NOT NULL;
ALTER TABLE "listings" ADD "items" text DEFAULT '[]' NOT NULL;
ALTER TABLE "listings" ADD "item_count" bigint DEFAULT 1 NOT NULL;
ALTER TABLE "listings" ADD "end_at" text DEFAULT '' NOT NULL;
ALTER TABLE "listings" ADD "bid_increment" bigint DEFAULT 500 NOT NULL;
ALTER TABLE "listings" ADD "current_bid" bigint;
ALTER TABLE "listings" ADD "bid_count" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "listings" ADD "leader_id" text;
ALTER TABLE "listings" ADD "leading_bid_id" text;
ALTER TABLE "listings" ADD "auction_version" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "listings" ADD "vault_revision" text DEFAULT '' NOT NULL;
ALTER TABLE "listings" ADD "usa_attested_at" text DEFAULT '' NOT NULL;
ALTER TABLE "auction_bids" ADD "rules_version" text DEFAULT '' NOT NULL;
ALTER TABLE profiles ADD deletion_started_at text;
CREATE INDEX listing_seller_state ON listings (seller_id,status);
CREATE INDEX listing_state_time ON listings (status,created_at);
CREATE TABLE "operation_guard" ( "id" text PRIMARY KEY NOT NULL, "valid" bigint NOT NULL, CONSTRAINT "operation_guard_valid" CHECK("operation_guard"."valid" = 1) );


-- 0007_commerce_sandbox.sql
CREATE TABLE "commerce_events" ( "id" text PRIMARY KEY NOT NULL, "order_id" text NOT NULL, "provider_event_id" text, "type" text NOT NULL, "body" text NOT NULL, "created_at" text NOT NULL );
CREATE UNIQUE INDEX "commerce_provider_event_unique" ON "commerce_events" ("provider_event_id");
CREATE INDEX "commerce_event_order" ON "commerce_events" ("order_id","created_at");
CREATE TABLE "commerce_money_requests" ( "id" text PRIMARY KEY NOT NULL, "order_id" text NOT NULL, "kind" text NOT NULL, "status" text NOT NULL, "amount_cents" bigint NOT NULL, "provider_id" text, "created_at" text NOT NULL, "updated_at" text NOT NULL, CONSTRAINT "commerce_money_positive" CHECK("commerce_money_requests"."amount_cents" > 0), CONSTRAINT "commerce_money_kind" CHECK("commerce_money_requests"."kind" IN ('refund','transfer')) );
CREATE UNIQUE INDEX "commerce_money_order_kind_unique" ON "commerce_money_requests" ("order_id","kind");
CREATE INDEX "commerce_money_status" ON "commerce_money_requests" ("status","updated_at");
CREATE TABLE "commerce_orders" ( "id" text PRIMARY KEY NOT NULL, "buyer_id" text NOT NULL, "buyer_user_id" text NOT NULL, "seller_id" text NOT NULL, "seller_user_id" text NOT NULL, "listing_id" text NOT NULL, "request_id" text NOT NULL, "status" text NOT NULL, "version" bigint DEFAULT 0 NOT NULL, "sandbox" bigint DEFAULT 1 NOT NULL, "snapshot" text NOT NULL, "state" text NOT NULL, "checkout_session_id" text, "payment_intent_id" text, "charge_id" text, "transfer_id" text, "created_at" text NOT NULL, "updated_at" text NOT NULL, CONSTRAINT "commerce_sandbox_only" CHECK("commerce_orders"."sandbox" = 1), CONSTRAINT "commerce_version_nonnegative" CHECK("commerce_orders"."version" >= 0) );
CREATE UNIQUE INDEX "commerce_order_request_unique" ON "commerce_orders" ("buyer_user_id","request_id");
CREATE UNIQUE INDEX "commerce_open_listing_unique" ON "commerce_orders" ("listing_id") WHERE "commerce_orders"."status" NOT IN ('cancelled','refunded','checkout_expired');
CREATE UNIQUE INDEX "commerce_checkout_session_unique" ON "commerce_orders" ("checkout_session_id");
CREATE UNIQUE INDEX "commerce_payment_intent_unique" ON "commerce_orders" ("payment_intent_id");
CREATE INDEX "commerce_order_buyer" ON "commerce_orders" ("buyer_user_id","created_at");
CREATE INDEX "commerce_order_seller" ON "commerce_orders" ("seller_user_id","created_at");
CREATE INDEX "commerce_order_status" ON "commerce_orders" ("status","updated_at");
CREATE TABLE "commerce_sellers" ( "profile_id" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "stripe_account_id" text, "state" text NOT NULL, "updated_at" text NOT NULL );
CREATE UNIQUE INDEX "commerce_seller_user_unique" ON "commerce_sellers" ("user_id");
CREATE UNIQUE INDEX "commerce_seller_account_unique" ON "commerce_sellers" ("stripe_account_id");


-- 0008_community_hub.sql
CREATE TABLE "group_post_reactions" ( "post_id" text NOT NULL, "profile_id" text NOT NULL, "created_at" text NOT NULL, PRIMARY KEY("post_id", "profile_id") );
CREATE INDEX "group_reaction_author" ON "group_post_reactions" ("profile_id");
CREATE TABLE "group_post_replies" ( "id" text PRIMARY KEY NOT NULL, "post_id" text NOT NULL, "profile_id" text NOT NULL, "body" text NOT NULL, "created_at" text NOT NULL );
CREATE INDEX "group_reply_post_time" ON "group_post_replies" ("post_id","created_at","id");
CREATE INDEX "group_reply_author" ON "group_post_replies" ("profile_id");
ALTER TABLE "group_posts" ADD "kind" text DEFAULT 'discussion' NOT NULL;
ALTER TABLE "group_posts" ADD "title" text DEFAULT '' NOT NULL;
ALTER TABLE "group_posts" ADD "photo_id" text;
CREATE INDEX "group_post_channel_time" ON "group_posts" ("group_id","channel","created_at","id");
CREATE INDEX "group_post_author" ON "group_posts" ("profile_id");


-- 0009_right_mephistopheles.sql
CREATE TABLE "catalog_creators" ( "metron_id" bigint PRIMARY KEY NOT NULL, "name" text NOT NULL );
CREATE TABLE "catalog_issue_creators" ( "issue_id" bigint NOT NULL, "creator_id" bigint NOT NULL, "role" text NOT NULL, PRIMARY KEY("issue_id", "creator_id", "role") );
CREATE TABLE "catalog_issues" ( "id" bigint PRIMARY KEY NOT NULL, "metron_id" bigint, "series_id" bigint, "publisher_id" bigint, "title" text NOT NULL, "number" text NOT NULL, "publisher" text NOT NULL, "year" bigint NOT NULL, "era" text NOT NULL, "kind" text NOT NULL, "search_text" text NOT NULL, "data" text NOT NULL, "source_modified" text DEFAULT '' NOT NULL, "fetched_at" text NOT NULL, "raw_metadata" text DEFAULT '' NOT NULL );
CREATE UNIQUE INDEX "catalog_metron_unique" ON "catalog_issues" ("metron_id");
CREATE INDEX "catalog_publisher_title" ON "catalog_issues" ("publisher","title","id");
CREATE INDEX "catalog_era_year" ON "catalog_issues" ("era","year","id");
CREATE INDEX "catalog_refresh_age" ON "catalog_issues" ("metron_id","fetched_at");
CREATE TABLE "catalog_publishers" ( "metron_id" bigint PRIMARY KEY NOT NULL, "name" text NOT NULL );
CREATE TABLE "catalog_series" ( "metron_id" bigint PRIMARY KEY NOT NULL, "publisher_id" bigint, "name" text NOT NULL, "year_began" bigint, "volume" bigint );
CREATE INDEX "catalog_series_publisher" ON "catalog_series" ("publisher_id");
CREATE TABLE "catalog_sync" ( "id" text PRIMARY KEY NOT NULL, "state" text NOT NULL, "lease_id" text DEFAULT '' NOT NULL, "lease_until" bigint DEFAULT 0 NOT NULL, "minute_start" bigint DEFAULT 0 NOT NULL, "minute_requests" bigint DEFAULT 0 NOT NULL, "day_start" bigint DEFAULT 0 NOT NULL, "day_requests" bigint DEFAULT 0 NOT NULL, "retry_at" bigint DEFAULT 0 NOT NULL );
CREATE TABLE "catalog_sync_seen" ( "run_id" text NOT NULL, "metron_id" bigint NOT NULL, "first_pass" bigint DEFAULT 0 NOT NULL, "last_pass" bigint NOT NULL, PRIMARY KEY("run_id", "metron_id") );
CREATE INDEX "catalog_seen_run_pass" ON "catalog_sync_seen" ("run_id","last_pass");


-- 0010_listing_pickup.sql
ALTER TABLE "listings" ADD "fulfillment" text DEFAULT 'shipping' NOT NULL;
ALTER TABLE "listings" ADD "pickup_city" text DEFAULT '' NOT NULL;
ALTER TABLE "listings" ADD "pickup_state" text DEFAULT '' NOT NULL;


-- 0011_trade_terms.sql
CREATE TABLE "trade_proposals" ( "id" text PRIMARY KEY NOT NULL, "thread_id" text NOT NULL, "listing_id" text NOT NULL, "buyer_id" text NOT NULL, "seller_id" text NOT NULL, "status" text DEFAULT 'pending' NOT NULL, "version" bigint DEFAULT 0 NOT NULL, "request_body" text NOT NULL, "buyer_items" text NOT NULL, "seller_items" text NOT NULL, "listing_snapshot" text NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL, "decided_at" text, "decided_by" text, CONSTRAINT "trade_status_valid" CHECK("trade_proposals"."status" IN ('pending','accepted','declined','cancelled')), CONSTRAINT "trade_version_valid" CHECK("trade_proposals"."version" >= 0), CONSTRAINT "trade_distinct_participants" CHECK("trade_proposals"."buyer_id" != "trade_proposals"."seller_id") );
CREATE INDEX "trade_thread_time" ON "trade_proposals" ("thread_id","created_at","id");
CREATE INDEX "trade_buyer" ON "trade_proposals" ("buyer_id");
CREATE INDEX "trade_seller" ON "trade_proposals" ("seller_id");
CREATE INDEX "trade_listing_state" ON "trade_proposals" ("listing_id","status");


-- 0012_gcd_central_catalog.sql
CREATE TABLE "catalog_gcd_seen" ("run_id" text NOT NULL, "kind" text NOT NULL, "provider_id" bigint NOT NULL, "completed" bigint DEFAULT 0 NOT NULL, PRIMARY KEY("run_id","kind","provider_id"), CONSTRAINT "catalog_gcd_seen_kind" CHECK("catalog_gcd_seen"."kind" IN ('series','issue')));
CREATE INDEX "catalog_gcd_seen_progress" ON "catalog_gcd_seen" ("run_id","kind","completed");
CREATE TABLE "catalog_gcd_series" ("gcd_id" bigint PRIMARY KEY NOT NULL, "data" text NOT NULL, "issue_ids" text NOT NULL, "fetched_at" text NOT NULL);
ALTER TABLE "catalog_issues" ADD "gcd_id" bigint;
CREATE UNIQUE INDEX "catalog_gcd_unique" ON "catalog_issues" ("gcd_id");
CREATE INDEX "catalog_gcd_refresh_age" ON "catalog_issues" ("gcd_id","fetched_at");


-- 0013_gcd_bulk_ingest.sql
CREATE TABLE "catalog_gcd_bulk_batches" ( "import_id" text NOT NULL, "batch_index" bigint NOT NULL, "content_sha256" text NOT NULL, "record_count" bigint NOT NULL, "written_records" bigint NOT NULL, "retained_newer_records" bigint NOT NULL, "first_provider_id" bigint NOT NULL, "last_provider_id" bigint NOT NULL, "chain_sha256" text NOT NULL, "committed_at" text NOT NULL, PRIMARY KEY("import_id", "batch_index"), CONSTRAINT "catalog_gcd_bulk_batch_counts" CHECK("catalog_gcd_bulk_batches"."batch_index">=0 AND "catalog_gcd_bulk_batches"."record_count">0 AND "catalog_gcd_bulk_batches"."record_count"<=8 AND "catalog_gcd_bulk_batches"."written_records">=0 AND "catalog_gcd_bulk_batches"."retained_newer_records">=0 AND "catalog_gcd_bulk_batches"."written_records"+"catalog_gcd_bulk_batches"."retained_newer_records"="catalog_gcd_bulk_batches"."record_count" AND "catalog_gcd_bulk_batches"."first_provider_id">0 AND "catalog_gcd_bulk_batches"."last_provider_id">="catalog_gcd_bulk_batches"."first_provider_id") );
CREATE TABLE "catalog_gcd_bulk_runs" ( "id" text PRIMARY KEY NOT NULL, "manifest" text NOT NULL, "stage" text DEFAULT 'OPEN' NOT NULL, "expected_records" bigint NOT NULL, "accepted_records" bigint DEFAULT 0 NOT NULL, "written_records" bigint DEFAULT 0 NOT NULL, "retained_newer_records" bigint DEFAULT 0 NOT NULL, "next_batch" bigint DEFAULT 0 NOT NULL, "last_provider_id" bigint DEFAULT 0 NOT NULL, "record_chain_sha256" text NOT NULL, "created_at" text NOT NULL, "finished_at" text, CONSTRAINT "catalog_gcd_bulk_stage" CHECK("catalog_gcd_bulk_runs"."stage" IN ('OPEN','COMPLETED','CANCELLED')), CONSTRAINT "catalog_gcd_bulk_counts" CHECK("catalog_gcd_bulk_runs"."expected_records">0 AND "catalog_gcd_bulk_runs"."accepted_records">=0 AND "catalog_gcd_bulk_runs"."accepted_records"<="catalog_gcd_bulk_runs"."expected_records" AND "catalog_gcd_bulk_runs"."written_records">=0 AND "catalog_gcd_bulk_runs"."retained_newer_records">=0 AND "catalog_gcd_bulk_runs"."written_records"+"catalog_gcd_bulk_runs"."retained_newer_records"="catalog_gcd_bulk_runs"."accepted_records" AND "catalog_gcd_bulk_runs"."next_batch">=0 AND "catalog_gcd_bulk_runs"."last_provider_id">=0) );
CREATE INDEX "catalog_gcd_bulk_stage" ON "catalog_gcd_bulk_runs" ("stage","created_at");


ALTER TABLE "catalog_issue_creators" ADD FOREIGN KEY ("issue_id") REFERENCES "catalog_issues"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "catalog_issue_creators" ADD FOREIGN KEY ("creator_id") REFERENCES "catalog_creators"("metron_id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "catalog_issues" ADD FOREIGN KEY ("series_id") REFERENCES "catalog_series"("metron_id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "catalog_issues" ADD FOREIGN KEY ("publisher_id") REFERENCES "catalog_publishers"("metron_id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "catalog_series" ADD FOREIGN KEY ("publisher_id") REFERENCES "catalog_publishers"("metron_id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "catalog_gcd_bulk_batches" ADD FOREIGN KEY ("import_id") REFERENCES "catalog_gcd_bulk_runs"("id") ON UPDATE no action ON DELETE no action;
