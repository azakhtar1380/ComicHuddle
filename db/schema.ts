import { pgSchema, text, bigint, doublePrecision as real } from 'drizzle-orm/pg-core';
const appTable=pgSchema('ch_web').table;
const integer=(name:string)=>bigint(name,{mode:'number'});
export const collections = appTable('collections', { userId: text('user_id').primaryKey(), data: text('data').notNull(),revision:text('revision').notNull().default('') });

// Only licensed, attributable production estimates belong in this table. No seeded prices.
export const marketValues=appTable('market_values',{
id:text('id').primaryKey(),issueId:integer('issue_id').notNull(),mode:text('mode').notNull(),grade:text('grade').notNull(),label:text('label').notNull(),printing:text('printing').notNull(),fmv:real('fmv').notNull(),low:real('low').notNull(),high:real('high').notNull(),sales:integer('sales').notNull(),windowDays:integer('window_days').notNull(),updatedAt:text('updated_at').notNull(),sourceName:text('source_name').notNull(),sourceUrl:text('source_url').notNull(),licenseReference:text('license_reference').notNull().default(''),rightsExpiresAt:text('rights_expires_at').notNull().default(''),importedAt:text('imported_at').notNull().default('')
});

import {uniqueIndex,primaryKey,index,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
// Transient rows enforce conditional validation inside an atomic PostgreSQL transaction.
export const operationGuard=appTable('operation_guard',{id:text('id').primaryKey(),valid:integer('valid').notNull()},t=>[check('operation_guard_valid',sql`${t.valid} = 1`)]);
export const profiles=appTable('profiles',{
id:text('id').primaryKey(),userId:text('user_id').notNull(),handle:text('handle').notNull(),name:text('name').notNull(),bio:text('bio').notNull(),tagline:text('tagline').notNull(),location:text('location').notNull(),favorite:text('favorite').notNull(),since:integer('since').notNull(),color:text('color').notNull(),featured:text('featured').notNull(),visible:integer('visible').notNull(),dmOpen:integer('dm_open').notNull(),createdAt:text('created_at').notNull(),moderated:integer('moderated').notNull().default(0),rulesVersion:text('rules_version').notNull().default(''),rulesAcceptedAt:text('rules_accepted_at').notNull().default(''),deletionStartedAt:text('deletion_started_at')
},t=>[uniqueIndex('profile_user_unique').on(t.userId),uniqueIndex('profile_handle_unique').on(t.handle)]);
export const groups=appTable('groups', {id:text('id').primaryKey(),ownerId:text('owner_id'),name:text('name').notNull(),description:text('description').notNull(),color:text('color').notNull(),createdAt:text('created_at').notNull()});
export const memberships=appTable('memberships',{groupId:text('group_id').notNull(),profileId:text('profile_id').notNull(),joinedAt:text('joined_at').notNull()},t=>[primaryKey({columns:[t.groupId,t.profileId]})]);
export const groupPosts=appTable('group_posts',{id:text('id').primaryKey(),groupId:text('group_id').notNull(),channel:text('channel').notNull(),profileId:text('profile_id').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull(),kind:text('kind').notNull().default('discussion'),title:text('title').notNull().default(''),photoId:text('photo_id')},t=>[index('group_post_time').on(t.groupId,t.createdAt),index('group_post_channel_time').on(t.groupId,t.channel,t.createdAt,t.id),index('group_post_author').on(t.profileId)]);
export const groupPostReplies=appTable('group_post_replies',{id:text('id').primaryKey(),postId:text('post_id').notNull(),profileId:text('profile_id').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()},t=>[index('group_reply_post_time').on(t.postId,t.createdAt,t.id),index('group_reply_author').on(t.profileId)]);
export const groupPostReactions=appTable('group_post_reactions',{postId:text('post_id').notNull(),profileId:text('profile_id').notNull(),createdAt:text('created_at').notNull()},t=>[primaryKey({columns:[t.postId,t.profileId]}),index('group_reaction_author').on(t.profileId)]);
export const threads=appTable('threads',{id:text('id').primaryKey(),pair:text('pair').notNull(),a:text('a').notNull(),b:text('b').notNull(),context:text('context').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('thread_pair_unique').on(t.pair)]);
export const messages=appTable('messages',{id:text('id').primaryKey(),threadId:text('thread_id').notNull(),profileId:text('profile_id').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()},t=>[index('thread_message_time').on(t.threadId,t.createdAt)]);
export const blocks=appTable('blocks',{fromId:text('from_id').notNull(),toId:text('to_id').notNull()},t=>[primaryKey({columns:[t.fromId,t.toId]})]);
export const listings=appTable('listings',{id:text('id').primaryKey(),sellerId:text('seller_id').notNull(),bookId:text('book_id').notNull(),issueId:integer('issue_id'),title:text('title').notNull(),grade:text('grade').notNull(),description:text('description').notNull(),price:integer('price').notNull(),shipping:integer('shipping').notNull(),photos:text('photos').notNull(),cert:text('cert').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull(),kind:text('kind').notNull().default('single'),saleType:text('sale_type').notNull().default('fixed'),items:text('items').notNull().default('[]'),itemCount:integer('item_count').notNull().default(1),endAt:text('end_at').notNull().default(''),bidIncrement:integer('bid_increment').notNull().default(500),currentBid:integer('current_bid'),bidCount:integer('bid_count').notNull().default(0),leaderId:text('leader_id'),leadingBidId:text('leading_bid_id'),auctionVersion:integer('auction_version').notNull().default(0),vaultRevision:text('vault_revision').notNull().default(''),usaAttestedAt:text('usa_attested_at').notNull().default(''),fulfillment:text('fulfillment').notNull().default('shipping'),pickupCity:text('pickup_city').notNull().default(''),pickupState:text('pickup_state').notNull().default('')},t=>[index('listing_seller_state').on(t.sellerId,t.status),index('listing_state_time').on(t.status,t.createdAt)]);
export const listingInventory=appTable('listing_inventory',{sellerId:text('seller_id').notNull(),bookId:text('book_id').notNull(),listingId:text('listing_id').notNull()},t=>[primaryKey({columns:[t.sellerId,t.bookId]}),index('listing_inventory_listing').on(t.listingId)]);
export const auctionBids=appTable('auction_bids',{id:text('id').primaryKey(),listingId:text('listing_id').notNull(),bidderId:text('bidder_id').notNull(),requestId:text('request_id').notNull(),amount:integer('amount').notNull(),status:text('status').notNull(),sequence:integer('sequence').notNull(),createdAt:text('created_at').notNull(),retractedAt:text('retracted_at'),retractedVersion:integer('retracted_version'),rulesVersion:text('rules_version').notNull().default('')},t=>[uniqueIndex('auction_bid_request').on(t.bidderId,t.requestId),index('auction_bid_listing').on(t.listingId,t.sequence),index('auction_bid_owner').on(t.bidderId,t.listingId,t.sequence)]);
export const offers=appTable('offers',{id:text('id').primaryKey(),listingId:text('listing_id').notNull(),buyerId:text('buyer_id').notNull(),amount:integer('amount').notNull(),note:text('note').notNull(),status:text('status').notNull(),createdAt:text('created_at').notNull()});
export const tradeProposals=appTable('trade_proposals',{
 id:text('id').primaryKey(),threadId:text('thread_id').notNull(),listingId:text('listing_id').notNull(),buyerId:text('buyer_id').notNull(),sellerId:text('seller_id').notNull(),status:text('status').notNull().default('pending'),version:integer('version').notNull().default(0),requestBody:text('request_body').notNull(),buyerItems:text('buyer_items').notNull(),sellerItems:text('seller_items').notNull(),listingSnapshot:text('listing_snapshot').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),decidedAt:text('decided_at'),decidedBy:text('decided_by')
},t=>[index('trade_thread_time').on(t.threadId,t.createdAt,t.id),index('trade_buyer').on(t.buyerId),index('trade_seller').on(t.sellerId),index('trade_listing_state').on(t.listingId,t.status),check('trade_status_valid',sql`${t.status} IN ('pending','accepted','declined','cancelled')`),check('trade_version_valid',sql`${t.version} >= 0`),check('trade_distinct_participants',sql`${t.buyerId} != ${t.sellerId}`)]);

export const swipes=appTable('swipes',{id:text('id').primaryKey(),pair:text('pair').notNull(),fromId:text('from_id').notNull(),toId:text('to_id').notNull(),giveId:text('give_id').notNull(),getId:text('get_id').notNull(),direction:text('direction').notNull(),createdAt:text('created_at').notNull()},t=>[uniqueIndex('swipe_owner_pair').on(t.fromId,t.pair)]);
export const media=appTable('media',{id:text('id').primaryKey(),userId:text('user_id').notNull(),contentType:text('content_type').notNull(),createdAt:text('created_at').notNull()});
export const reports=appTable('reports',{id:text('id').primaryKey(),profileId:text('profile_id').notNull(),targetType:text('target_type').notNull(),targetId:text('target_id').notNull(),reason:text('reason').notNull(),createdAt:text('created_at').notNull()});

export const careProviders=appTable('care_providers',{
id:text('id').primaryKey(),profileId:text('profile_id').notNull(),name:text('name').notNull(),bio:text('bio').notNull(),location:text('location').notNull(),services:text('services').notNull(),prices:text('prices').notNull(),specialties:text('specialties').notNull(),experienceSince:integer('experience_since').notNull(),turnaroundMin:integer('turnaround_min').notNull(),turnaroundMax:integer('turnaround_max').notNull(),mailIn:integer('mail_in').notNull(),dropoff:integer('dropoff').notNull(),accepting:integer('accepting').notNull(),visible:integer('visible').notNull(),submissionMode:text('submission_mode').notNull(),dealerReference:text('dealer_reference').notNull(),website:text('website').notNull(),logoId:text('logo_id'),portfolio:text('portfolio').notNull(),shippingAddress:text('shipping_address').notNull(),shippingNotes:text('shipping_notes').notNull(),terms:text('terms').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),moderated:integer('moderated').notNull().default(0)
},t=>[uniqueIndex('care_provider_profile').on(t.profileId)]);
export const careReviews=appTable('care_reviews',{
id:text('id').primaryKey(),providerId:text('provider_id').notNull(),authorId:text('author_id').notNull(),jobId:text('job_id'),rating:integer('rating').notNull(),quality:integer('quality').notNull(),communication:integer('communication').notNull(),timeliness:integer('timeliness').notNull(),title:text('title').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('care_review_author_provider').on(t.providerId,t.authorId),index('care_reviews_provider').on(t.providerId)]);
export const careJobs=appTable('care_jobs',{
id:text('id').primaryKey(),providerId:text('provider_id').notNull(),providerProfileId:text('provider_profile_id').notNull(),requesterId:text('requester_id').notNull(),threadId:text('thread_id').notNull(),books:text('books').notNull(),services:text('services').notNull(),notes:text('notes').notNull(),sendToCgc:integer('send_to_cgc').notNull(),status:text('status').notNull(),method:text('method').notNull(),fee:integer('fee'),returnShipping:integer('return_shipping'),cgcEstimate:integer('cgc_estimate'),quoteNotes:text('quote_notes').notNull(),quoteDays:integer('quote_days'),quoteRevision:integer('quote_revision').notNull(),termsSnapshot:text('terms_snapshot').notNull(),shippingAddress:text('shipping_address').notNull(),shippingNotes:text('shipping_notes').notNull(),returnAddress:text('return_address').notNull(),incomingCarrier:text('incoming_carrier').notNull(),incomingTracking:text('incoming_tracking').notNull(),outgoingCarrier:text('outgoing_carrier').notNull(),outgoingTracking:text('outgoing_tracking').notNull(),submissionRef:text('submission_ref').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[index('care_jobs_requester').on(t.requesterId),index('care_jobs_provider').on(t.providerProfileId)]);
export const careEvents=appTable('care_events',{
id:text('id').primaryKey(),jobId:text('job_id').notNull(),actorId:text('actor_id').notNull(),status:text('status').notNull(),note:text('note').notNull(),photos:text('photos').notNull(),createdAt:text('created_at').notNull()
},t=>[index('care_events_job').on(t.jobId,t.createdAt)]);

// One rolling counter per account/action/window. Updates are atomic across workers.
export const writeLimits=appTable('write_limits',{
id:text('id').primaryKey(),userId:text('user_id').notNull(),windowStart:integer('window_start').notNull(),requests:integer('requests').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('write_limits_expiry').on(t.expiresAt)]);

// Kept separately so deleting a public profile cannot evade an owner restriction.
export const accountRestrictions=appTable('account_restrictions',{
userId:text('user_id').notNull(),scope:text('scope').notNull(),createdAt:text('created_at').notNull()
},t=>[primaryKey({columns:[t.userId,t.scope]})]);

// Sandbox-only commerce. No live funds or credential values belong in these rows.
export const commerceOrders=appTable('commerce_orders',{
 id:text('id').primaryKey(),buyerId:text('buyer_id').notNull(),buyerUserId:text('buyer_user_id').notNull(),sellerId:text('seller_id').notNull(),sellerUserId:text('seller_user_id').notNull(),listingId:text('listing_id').notNull(),requestId:text('request_id').notNull(),status:text('status').notNull(),version:integer('version').notNull().default(0),sandbox:integer('sandbox').notNull().default(1),snapshot:text('snapshot').notNull(),state:text('state').notNull(),checkoutSessionId:text('checkout_session_id'),paymentIntentId:text('payment_intent_id'),chargeId:text('charge_id'),transferId:text('transfer_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('commerce_order_request_unique').on(t.buyerUserId,t.requestId),uniqueIndex('commerce_open_listing_unique').on(t.listingId).where(sql`${t.status} NOT IN ('cancelled','refunded','checkout_expired')`),uniqueIndex('commerce_checkout_session_unique').on(t.checkoutSessionId),uniqueIndex('commerce_payment_intent_unique').on(t.paymentIntentId),index('commerce_order_buyer').on(t.buyerUserId,t.createdAt),index('commerce_order_seller').on(t.sellerUserId,t.createdAt),index('commerce_order_status').on(t.status,t.updatedAt),check('commerce_sandbox_only',sql`${t.sandbox} = 1`),check('commerce_version_nonnegative',sql`${t.version} >= 0`)]);
export const commerceEvents=appTable('commerce_events',{
 id:text('id').primaryKey(),orderId:text('order_id').notNull(),providerEventId:text('provider_event_id'),type:text('type').notNull(),body:text('body').notNull(),createdAt:text('created_at').notNull()
},t=>[uniqueIndex('commerce_provider_event_unique').on(t.providerEventId),index('commerce_event_order').on(t.orderId,t.createdAt)]);
export const commerceSellers=appTable('commerce_sellers',{
 profileId:text('profile_id').primaryKey(),userId:text('user_id').notNull(),stripeAccountId:text('stripe_account_id'),state:text('state').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('commerce_seller_user_unique').on(t.userId),uniqueIndex('commerce_seller_account_unique').on(t.stripeAccountId)]);
export const commerceMoneyRequests=appTable('commerce_money_requests',{
 id:text('id').primaryKey(),orderId:text('order_id').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),amountCents:integer('amount_cents').notNull(),providerId:text('provider_id'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[uniqueIndex('commerce_money_order_kind_unique').on(t.orderId,t.kind),index('commerce_money_status').on(t.status,t.updatedAt),check('commerce_money_positive',sql`${t.amountCents} > 0`),check('commerce_money_kind',sql`${t.kind} IN ('refund','transfer')`)]);

// Shared bibliographic metadata, separate from private collections and FMV.
export const catalogPublishers=appTable('catalog_publishers',{
 metronId:integer('metron_id').primaryKey(),name:text('name').notNull()
});
export const catalogSeries=appTable('catalog_series',{
 metronId:integer('metron_id').primaryKey(),publisherId:integer('publisher_id').references(()=>catalogPublishers.metronId),name:text('name').notNull(),yearBegan:integer('year_began'),volume:integer('volume')
},t=>[index('catalog_series_publisher').on(t.publisherId)]);
export const catalogCreators=appTable('catalog_creators',{
 metronId:integer('metron_id').primaryKey(),name:text('name').notNull()
});
export const catalogIssues=appTable('catalog_issues',{
 id:integer('id').primaryKey(),metronId:integer('metron_id'),gcdId:integer('gcd_id'),seriesId:integer('series_id').references(()=>catalogSeries.metronId),publisherId:integer('publisher_id').references(()=>catalogPublishers.metronId),title:text('title').notNull(),number:text('number').notNull(),publisher:text('publisher').notNull(),year:integer('year').notNull(),era:text('era').notNull(),kind:text('kind').notNull(),searchText:text('search_text').notNull(),data:text('data').notNull(),sourceModified:text('source_modified').notNull().default(''),fetchedAt:text('fetched_at').notNull(),rawMetadata:text('raw_metadata').notNull().default('')
},t=>[uniqueIndex('catalog_metron_unique').on(t.metronId),uniqueIndex('catalog_gcd_unique').on(t.gcdId),index('catalog_publisher_title').on(t.publisher,t.title,t.id),index('catalog_era_year').on(t.era,t.year,t.id),index('catalog_refresh_age').on(t.metronId,t.fetchedAt),index('catalog_gcd_refresh_age').on(t.gcdId,t.fetchedAt)]);
export const catalogIssueCreators=appTable('catalog_issue_creators',{
 issueId:integer('issue_id').notNull().references(()=>catalogIssues.id),creatorId:integer('creator_id').notNull().references(()=>catalogCreators.metronId),role:text('role').notNull()
},t=>[primaryKey({columns:[t.issueId,t.creatorId,t.role]})]);
export const catalogSync=appTable('catalog_sync',{
 id:text('id').primaryKey(),state:text('state').notNull(),leaseId:text('lease_id').notNull().default(''),leaseUntil:integer('lease_until').notNull().default(0),minuteStart:integer('minute_start').notNull().default(0),minuteRequests:integer('minute_requests').notNull().default(0),dayStart:integer('day_start').notNull().default(0),dayRequests:integer('day_requests').notNull().default(0),retryAt:integer('retry_at').notNull().default(0)
});
export const catalogSyncSeen=appTable('catalog_sync_seen',{
 runId:text('run_id').notNull(),metronId:integer('metron_id').notNull(),firstPass:integer('first_pass').notNull().default(0),lastPass:integer('last_pass').notNull()
},t=>[primaryKey({columns:[t.runId,t.metronId]}),index('catalog_seen_run_pass').on(t.runId,t.lastPass)]);
// Provider-specific checkpoint data never rewrites Metron's catalog/settings.
export const catalogGcdSeries=appTable('catalog_gcd_series',{
 gcdId:integer('gcd_id').primaryKey(),data:text('data').notNull(),issueIds:text('issue_ids').notNull(),fetchedAt:text('fetched_at').notNull()
});
export const catalogGcdSeen=appTable('catalog_gcd_seen',{
 runId:text('run_id').notNull(),kind:text('kind').notNull(),providerId:integer('provider_id').notNull(),completed:integer('completed').notNull().default(0)
},t=>[primaryKey({columns:[t.runId,t.kind,t.providerId]}),index('catalog_gcd_seen_progress').on(t.runId,t.kind,t.completed),check('catalog_gcd_seen_kind',sql`${t.kind} IN ('series','issue')`)]);
export const catalogGcdBulkRuns=appTable('catalog_gcd_bulk_runs',{
 id:text('id').primaryKey(),manifest:text('manifest').notNull(),stage:text('stage').notNull().default('OPEN'),expectedRecords:integer('expected_records').notNull(),acceptedRecords:integer('accepted_records').notNull().default(0),writtenRecords:integer('written_records').notNull().default(0),retainedNewerRecords:integer('retained_newer_records').notNull().default(0),nextBatch:integer('next_batch').notNull().default(0),lastProviderId:integer('last_provider_id').notNull().default(0),recordChainSha256:text('record_chain_sha256').notNull(),createdAt:text('created_at').notNull(),finishedAt:text('finished_at')
},t=>[index('catalog_gcd_bulk_stage').on(t.stage,t.createdAt),check('catalog_gcd_bulk_stage',sql`${t.stage} IN ('OPEN','COMPLETED','CANCELLED')`),check('catalog_gcd_bulk_counts',sql`${t.expectedRecords}>0 AND ${t.acceptedRecords}>=0 AND ${t.acceptedRecords}<=${t.expectedRecords} AND ${t.writtenRecords}>=0 AND ${t.retainedNewerRecords}>=0 AND ${t.writtenRecords}+${t.retainedNewerRecords}=${t.acceptedRecords} AND ${t.nextBatch}>=0 AND ${t.lastProviderId}>=0`)]);
export const catalogGcdBulkBatches=appTable('catalog_gcd_bulk_batches',{
 importId:text('import_id').notNull().references(()=>catalogGcdBulkRuns.id),batchIndex:integer('batch_index').notNull(),contentSha256:text('content_sha256').notNull(),recordCount:integer('record_count').notNull(),writtenRecords:integer('written_records').notNull(),retainedNewerRecords:integer('retained_newer_records').notNull(),firstProviderId:integer('first_provider_id').notNull(),lastProviderId:integer('last_provider_id').notNull(),chainSha256:text('chain_sha256').notNull(),committedAt:text('committed_at').notNull()
},t=>[primaryKey({columns:[t.importId,t.batchIndex]}),check('catalog_gcd_bulk_batch_counts',sql`${t.batchIndex}>=0 AND ${t.recordCount}>0 AND ${t.recordCount}<=8 AND ${t.writtenRecords}>=0 AND ${t.retainedNewerRecords}>=0 AND ${t.writtenRecords}+${t.retainedNewerRecords}=${t.recordCount} AND ${t.firstProviderId}>0 AND ${t.lastProviderId}>=${t.firstProviderId}`)]);
