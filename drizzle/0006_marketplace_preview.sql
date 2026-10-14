CREATE TABLE `auction_bids` ( `id` text PRIMARY KEY NOT NULL, `listing_id` text NOT NULL, `bidder_id` text NOT NULL, `request_id` text NOT NULL, `amount` integer NOT NULL, `status` text NOT NULL, `sequence` integer NOT NULL, `created_at` text NOT NULL, `retracted_at` text, `retracted_version` integer );--> statement-breakpoint
CREATE UNIQUE INDEX `auction_bid_request` ON `auction_bids` (`bidder_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `auction_bid_listing` ON `auction_bids` (`listing_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `auction_bid_owner` ON `auction_bids` (`bidder_id`,`listing_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `listing_inventory` ( `seller_id` text NOT NULL, `book_id` text NOT NULL, `listing_id` text NOT NULL, PRIMARY KEY(`seller_id`, `book_id`) );--> statement-breakpoint
CREATE INDEX `listing_inventory_listing` ON `listing_inventory` (`listing_id`);--> statement-breakpoint
ALTER TABLE `listings` ADD `kind` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `sale_type` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `item_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `end_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `bid_increment` integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `current_bid` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `bid_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `leader_id` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `leading_bid_id` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `auction_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `vault_revision` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `usa_attested_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `auction_bids` ADD `rules_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE profiles ADD deletion_started_at text;--> statement-breakpoint
CREATE INDEX listing_seller_state ON listings (seller_id,status);--> statement-breakpoint
CREATE INDEX listing_state_time ON listings (status,created_at);--> statement-breakpoint
CREATE TABLE `operation_guard` ( `id` text PRIMARY KEY NOT NULL, `valid` integer NOT NULL, CONSTRAINT "operation_guard_valid" CHECK("operation_guard"."valid" = 1) );
