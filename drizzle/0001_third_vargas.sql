CREATE TABLE `market_values` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` integer NOT NULL,
	`mode` text NOT NULL,
	`grade` text NOT NULL,
	`label` text NOT NULL,
	`printing` text NOT NULL,
	`fmv` real NOT NULL,
	`low` real NOT NULL,
	`high` real NOT NULL,
	`sales` integer NOT NULL,
	`window_days` integer NOT NULL,
	`updated_at` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL
);
