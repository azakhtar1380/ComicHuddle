ALTER TABLE `listings` ADD `fulfillment` text DEFAULT 'shipping' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `pickup_city` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `pickup_state` text DEFAULT '' NOT NULL;
