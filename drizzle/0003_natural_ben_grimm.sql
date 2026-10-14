CREATE TABLE `care_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`photos` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `care_events_job` ON `care_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `care_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`books` text NOT NULL,
	`services` text NOT NULL,
	`notes` text NOT NULL,
	`send_to_cgc` integer NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`fee` integer,
	`return_shipping` integer,
	`cgc_estimate` integer,
	`quote_notes` text NOT NULL,
	`quote_days` integer,
	`quote_revision` integer NOT NULL,
	`terms_snapshot` text NOT NULL,
	`shipping_address` text NOT NULL,
	`shipping_notes` text NOT NULL,
	`return_address` text NOT NULL,
	`incoming_carrier` text NOT NULL,
	`incoming_tracking` text NOT NULL,
	`outgoing_carrier` text NOT NULL,
	`outgoing_tracking` text NOT NULL,
	`submission_ref` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `care_jobs_requester` ON `care_jobs` (`requester_id`);--> statement-breakpoint
CREATE INDEX `care_jobs_provider` ON `care_jobs` (`provider_profile_id`);--> statement-breakpoint
CREATE TABLE `care_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`bio` text NOT NULL,
	`location` text NOT NULL,
	`services` text NOT NULL,
	`prices` text NOT NULL,
	`specialties` text NOT NULL,
	`experience_since` integer NOT NULL,
	`turnaround_min` integer NOT NULL,
	`turnaround_max` integer NOT NULL,
	`mail_in` integer NOT NULL,
	`dropoff` integer NOT NULL,
	`accepting` integer NOT NULL,
	`visible` integer NOT NULL,
	`submission_mode` text NOT NULL,
	`dealer_reference` text NOT NULL,
	`website` text NOT NULL,
	`logo_id` text,
	`portfolio` text NOT NULL,
	`shipping_address` text NOT NULL,
	`shipping_notes` text NOT NULL,
	`terms` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_provider_profile` ON `care_providers` (`profile_id`);--> statement-breakpoint
CREATE TABLE `care_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`author_id` text NOT NULL,
	`job_id` text,
	`rating` integer NOT NULL,
	`quality` integer NOT NULL,
	`communication` integer NOT NULL,
	`timeliness` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_review_author_provider` ON `care_reviews` (`provider_id`,`author_id`);--> statement-breakpoint
CREATE INDEX `care_reviews_provider` ON `care_reviews` (`provider_id`);