ALTER TABLE `collections` ADD `revision` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profiles` ADD `moderated` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `profiles` ADD `rules_version` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profiles` ADD `rules_accepted_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `care_providers` ADD `moderated` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `write_limits` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `window_start` integer NOT NULL,
  `requests` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `write_limits_expiry` ON `write_limits` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `account_restrictions` (
  `user_id` text NOT NULL,
  `scope` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`user_id`, `scope`)
);
