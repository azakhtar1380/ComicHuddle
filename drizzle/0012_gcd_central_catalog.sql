CREATE TABLE `catalog_gcd_seen` (`run_id` text NOT NULL, `kind` text NOT NULL, `provider_id` integer NOT NULL, `completed` integer DEFAULT 0 NOT NULL, PRIMARY KEY(`run_id`,`kind`,`provider_id`), CONSTRAINT "catalog_gcd_seen_kind" CHECK("catalog_gcd_seen"."kind" IN ('series','issue')));--> statement-breakpoint
CREATE INDEX `catalog_gcd_seen_progress` ON `catalog_gcd_seen` (`run_id`,`kind`,`completed`);--> statement-breakpoint
CREATE TABLE `catalog_gcd_series` (`gcd_id` integer PRIMARY KEY NOT NULL, `data` text NOT NULL, `issue_ids` text NOT NULL, `fetched_at` text NOT NULL);--> statement-breakpoint
ALTER TABLE `catalog_issues` ADD `gcd_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_gcd_unique` ON `catalog_issues` (`gcd_id`);--> statement-breakpoint
CREATE INDEX `catalog_gcd_refresh_age` ON `catalog_issues` (`gcd_id`,`fetched_at`);
