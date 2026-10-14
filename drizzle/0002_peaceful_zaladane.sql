CREATE TABLE `blocks` (
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	PRIMARY KEY(`from_id`, `to_id`)
);
--> statement-breakpoint
CREATE TABLE `group_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`channel` text NOT NULL,
	`profile_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `group_post_time` ON `group_posts` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`book_id` text NOT NULL,
	`issue_id` integer,
	`title` text NOT NULL,
	`grade` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`shipping` integer NOT NULL,
	`photos` text NOT NULL,
	`cert` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`group_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`joined_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `profile_id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_message_time` ON `messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`bio` text NOT NULL,
	`tagline` text NOT NULL,
	`location` text NOT NULL,
	`favorite` text NOT NULL,
	`since` integer NOT NULL,
	`color` text NOT NULL,
	`featured` text NOT NULL,
	`visible` integer NOT NULL,
	`dm_open` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_user_unique` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profile_handle_unique` ON `profiles` (`handle`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `swipes` (
	`id` text PRIMARY KEY NOT NULL,
	`pair` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`give_id` text NOT NULL,
	`get_id` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `swipe_owner_pair` ON `swipes` (`from_id`,`pair`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`pair` text NOT NULL,
	`a` text NOT NULL,
	`b` text NOT NULL,
	`context` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_pair_unique` ON `threads` (`pair`);