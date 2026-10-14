CREATE TABLE `commerce_events` ( `id` text PRIMARY KEY NOT NULL, `order_id` text NOT NULL, `provider_event_id` text, `type` text NOT NULL, `body` text NOT NULL, `created_at` text NOT NULL );--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_provider_event_unique` ON `commerce_events` (`provider_event_id`);--> statement-breakpoint
CREATE INDEX `commerce_event_order` ON `commerce_events` (`order_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `commerce_money_requests` ( `id` text PRIMARY KEY NOT NULL, `order_id` text NOT NULL, `kind` text NOT NULL, `status` text NOT NULL, `amount_cents` integer NOT NULL, `provider_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL, CONSTRAINT "commerce_money_positive" CHECK("commerce_money_requests"."amount_cents" > 0), CONSTRAINT "commerce_money_kind" CHECK("commerce_money_requests"."kind" IN ('refund','transfer')) );--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_money_order_kind_unique` ON `commerce_money_requests` (`order_id`,`kind`);--> statement-breakpoint
CREATE INDEX `commerce_money_status` ON `commerce_money_requests` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `commerce_orders` ( `id` text PRIMARY KEY NOT NULL, `buyer_id` text NOT NULL, `buyer_user_id` text NOT NULL, `seller_id` text NOT NULL, `seller_user_id` text NOT NULL, `listing_id` text NOT NULL, `request_id` text NOT NULL, `status` text NOT NULL, `version` integer DEFAULT 0 NOT NULL, `sandbox` integer DEFAULT 1 NOT NULL, `snapshot` text NOT NULL, `state` text NOT NULL, `checkout_session_id` text, `payment_intent_id` text, `charge_id` text, `transfer_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL, CONSTRAINT "commerce_sandbox_only" CHECK("commerce_orders"."sandbox" = 1), CONSTRAINT "commerce_version_nonnegative" CHECK("commerce_orders"."version" >= 0) );--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_order_request_unique` ON `commerce_orders` (`buyer_user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_open_listing_unique` ON `commerce_orders` (`listing_id`) WHERE "commerce_orders"."status" NOT IN ('cancelled','refunded','checkout_expired');--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_checkout_session_unique` ON `commerce_orders` (`checkout_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_payment_intent_unique` ON `commerce_orders` (`payment_intent_id`);--> statement-breakpoint
CREATE INDEX `commerce_order_buyer` ON `commerce_orders` (`buyer_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `commerce_order_seller` ON `commerce_orders` (`seller_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `commerce_order_status` ON `commerce_orders` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `commerce_sellers` ( `profile_id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `stripe_account_id` text, `state` text NOT NULL, `updated_at` text NOT NULL );--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_seller_user_unique` ON `commerce_sellers` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commerce_seller_account_unique` ON `commerce_sellers` (`stripe_account_id`);--> statement-breakpoint
