CREATE TABLE `group_post_reactions` ( `post_id` text NOT NULL, `profile_id` text NOT NULL, `created_at` text NOT NULL, PRIMARY KEY(`post_id`, `profile_id`) );--> statement-breakpoint
CREATE INDEX `group_reaction_author` ON `group_post_reactions` (`profile_id`);--> statement-breakpoint
CREATE TABLE `group_post_replies` ( `id` text PRIMARY KEY NOT NULL, `post_id` text NOT NULL, `profile_id` text NOT NULL, `body` text NOT NULL, `created_at` text NOT NULL );--> statement-breakpoint
CREATE INDEX `group_reply_post_time` ON `group_post_replies` (`post_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `group_reply_author` ON `group_post_replies` (`profile_id`);--> statement-breakpoint
ALTER TABLE `group_posts` ADD `kind` text DEFAULT 'discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE `group_posts` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `group_posts` ADD `photo_id` text;--> statement-breakpoint
CREATE INDEX `group_post_channel_time` ON `group_posts` (`group_id`,`channel`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `group_post_author` ON `group_posts` (`profile_id`);--> statement-breakpoint
