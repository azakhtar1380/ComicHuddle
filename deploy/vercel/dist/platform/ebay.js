import { z } from 'zod';
import { canonicalJson, DomainError, once, serializable, sha256 } from './db.js';
import { amountString, cents } from './money.js';
import { inventoryFingerprint } from './inventory-fingerprint.js';
import { listingVerificationGate } from './scans.js';
const base = (e) => e === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const auth = (e) => e === 'sandbox' ? 'https://auth.sandbox.ebay.com' : 'https://auth.ebay.com';
function b64(bytes) { return btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')); }
function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function randomToken() { const b = crypto.getRandomValues(new Uint8Array(32)); return b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export class AesGcmTokenVault {
    key;
    constructor(key) {
        this.key = key;
    }
    static async fromKey(bytes) { if (bytes.length !== 32)
        throw new DomainError('vault_key_invalid', 'Use a 256-bit token-encryption key.'); return new AesGcmTokenVault(await crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])); }
    async encrypt(value, userId) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, this.key, new TextEncoder().encode(value)); return 'v1.' + b64(iv) + '.' + b64(new Uint8Array(data)); }
    async decrypt(value, userId) { const [version, iv, payload] = value.split('.'); if (version !== 'v1' || !iv || !payload)
        throw new DomainError('vault_record_invalid', 'Encrypted credential is invalid.'); const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, this.key, unb64(payload)); return new TextDecoder().decode(data); }
}
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive(), refresh_token: z.string().min(1).optional(), refresh_token_expires_in: z.number().int().positive().optional() });
export class EbayOAuthService {
    pool;
    cfg;
    vault;
    resolveIdentity;
    http;
    constructor(pool, cfg, vault, resolveIdentity, http = fetch) {
        this.pool = pool;
        this.cfg = cfg;
        this.vault = vault;
        this.resolveIdentity = resolveIdentity;
        this.http = http;
        if (cfg.environment === 'production' && !cfg.productionApproved)
            throw new DomainError('ebay_production_disabled', 'Use the eBay Sandbox until production access is approved.');
    }
    async start(userId, browserSession) {
        const state = randomToken(), stateHash = await sha256(state), sessionHash = await sha256(browserSession);
        await serializable(this.pool, db => db.query('INSERT INTO ch_platform.ebay_oauth_sessions(state_hash,user_id,browser_session_hash,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')', [stateHash, userId, sessionHash]));
        const url = new URL(auth(this.cfg.environment) + '/oauth2/authorize');
        url.search = new URLSearchParams({ client_id: this.cfg.clientId, redirect_uri: this.cfg.ruName, response_type: 'code', scope: this.cfg.scopes.join(' '), state }).toString();
        return url.toString();
    }
    async token(body) {
        const response = await this.http(base(this.cfg.environment) + '/identity/v1/oauth2/token', { method: 'POST', redirect: 'error', headers: { Authorization: 'Basic ' + b64(new TextEncoder().encode(this.cfg.clientId + ':' + this.cfg.clientSecret)), 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
        if (!response.ok)
            throw new DomainError('ebay_authorization_failed', 'Reconnect the eBay account.', 401);
        return tokenSchema.parse(await response.json());
    }
    async callback(userId, browserSession, state, code) {
        if (!state || !code || code.length > 4096)
            throw new DomainError('invalid_oauth_callback', 'Invalid authorization callback.', 400);
        const stateHash = await sha256(state), sessionHash = await sha256(browserSession);
        await serializable(this.pool, async (db) => {
            const row = (await db.query('SELECT * FROM ch_platform.ebay_oauth_sessions WHERE state_hash=$1 FOR UPDATE', [stateHash])).rows[0];
            if (!row || row.user_id !== userId || row.browser_session_hash !== sessionHash || row.consumed_at || Date.parse(row.expires_at) < Date.now())
                throw new DomainError('oauth_state_invalid', 'Authorization session expired or does not match this account.', 403);
            await db.query('UPDATE ch_platform.ebay_oauth_sessions SET consumed_at=now() WHERE state_hash=$1', [stateHash]);
        });
        // Official eBay confidential-client grant. PKCE is not documented here; do
        // not add invented code_challenge/code_verifier fields or expose the secret.
        const tokens = await this.token(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.ruName }));
        if (!tokens.refresh_token)
            throw new DomainError('refresh_token_missing', 'eBay did not return durable consent.', 502);
        const identity = await this.resolveIdentity(tokens.access_token);
        if (!identity)
            throw new DomainError('ebay_identity_missing', 'eBay account identity could not be verified.', 502);
        const access = await this.vault.encrypt(tokens.access_token, userId), refresh = await this.vault.encrypt(tokens.refresh_token, userId);
        await serializable(this.pool, db => db.query(`INSERT INTO ch_platform.ebay_connections(user_id,ebay_user_id,access_token_ciphertext,refresh_token_ciphertext,expires_at,scopes)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET ebay_user_id=EXCLUDED.ebay_user_id,access_token_ciphertext=EXCLUDED.access_token_ciphertext,
   refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,expires_at=EXCLUDED.expires_at,scopes=EXCLUDED.scopes`, [userId, identity, access, refresh, new Date(Date.now() + tokens.expires_in * 1000).toISOString(), this.cfg.scopes]));
        return { connected: true };
    }
    async accessToken(userId) {
        return serializable(this.pool, async (db) => {
            const row = (await db.query('SELECT * FROM ch_platform.ebay_connections WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
            if (!row)
                throw new DomainError('ebay_not_connected', 'Connect an eBay account.', 401);
            if (Date.parse(row.expires_at) > Date.now() + 60000)
                return this.vault.decrypt(row.access_token_ciphertext, userId);
            const refresh = await this.vault.decrypt(row.refresh_token_ciphertext, userId);
            const token = await this.token(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, scope: this.cfg.scopes.join(' ') }));
            await db.query('UPDATE ch_platform.ebay_connections SET access_token_ciphertext=$2,expires_at=$3 WHERE user_id=$1', [userId, await this.vault.encrypt(token.access_token, userId), new Date(Date.now() + token.expires_in * 1000).toISOString()]);
            return token.access_token;
        });
    }
}
export function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function itemSpecifics(m) { return { Publisher: [m.publisher], Character: m.characters.slice(0, 20), 'Issue Number': [m.issueNumber], Grade: [m.gradeLabel], Era: [m.era], 'Publication Year': [], Features: [m.printingLabel, m.variantLabel].filter(Boolean) }; }
export function conditionAndValueReport(m, quote) {
    const baseline = ['sold_estimate', 'licensed_fmv'].includes(quote.kind) && quote.valueCents ? 'Estimated FMV: $' + amountString(cents(quote.valueCents)) + ' USD. ' + quote.sampleCount + ' samples. As of ' + (quote.asOf || 'unavailable') + '.' : quote.kind === 'asking_range' ? 'Only active asking prices are available; no sold FMV baseline.' : 'FMV unavailable for this edition and condition.';
    const title = m.physicalInspection ? 'Inspection & estimated-value report' : 'Seller condition & estimated-value report';
    const lines = [m.title + ' #' + m.issueNumber, m.printingLabel + ' · ' + m.variantLabel, 'Condition: ' + m.conditionDescription, (m.certNumber ? 'Seller-supplied certification number: ' + m.certNumber : ''), baseline, m.physicalInspection ? 'Physical inspection evidence is recorded.' : 'Condition is seller-declared; photo matching does not authenticate the book.', 'Market estimates are not guarantees, appraisals or investment advice.'].filter(Boolean);
    return { plainText: title + '\n' + lines.join('\n'), html: '<h2>' + escapeHtml(title) + '</h2><ul>' + lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>' };
}
export function buildEbayDraft(input) {
    if (!input.allowedConditions.includes(input.condition))
        throw new DomainError('invalid_ebay_condition', 'Use the condition offered by eBay category metadata.', 400);
    if (!/^\d+$/.test(input.categoryId) || !input.locationKey || Object.values(input.policies).some(v => !/^\d+$/.test(v)))
        throw new DomainError('ebay_publish_prerequisites', 'eBay category, inventory location and business policies are required.', 400);
    if (input.images.length < 1 || input.images.length > 12)
        throw new DomainError('ebay_images_missing', 'Provide one to twelve listing images.', 400);
    for (const image of input.images) {
        const u = new URL(image);
        if (u.protocol !== 'https:' || u.username || u.password || u.port || !input.cdnOrigins.includes(u.origin))
            throw new DomainError('ebay_image_origin_invalid', 'Use approved public CDN images.', 400);
    }
    const report = conditionAndValueReport(input.metadata, input.valuation), aspects = itemSpecifics(input.metadata);
    delete aspects['Publication Year'];
    const inventory = { availability: { shipToLocationAvailability: { quantity: 1 } }, condition: input.condition, product: { title: (input.metadata.title + ' #' + input.metadata.issueNumber + ' ' + input.metadata.gradeLabel).slice(0, 80), description: report.plainText, aspects, imageUrls: input.images } };
    return { sku: input.sku, inventory, offer: { sku: input.sku, marketplaceId: 'EBAY_US', format: 'FIXED_PRICE', availableQuantity: 1, categoryId: input.categoryId, merchantLocationKey: input.locationKey, listingDescription: report.html, listingDuration: 'GTC', listingPolicies: input.policies, pricingSummary: { price: { value: amountString(cents(input.askingCents)), currency: 'USD' } } } };
}
export class EbayInventoryClient {
    cfg;
    getToken;
    http;
    constructor(cfg, getToken, http = fetch) {
        this.cfg = cfg;
        this.getToken = getToken;
        this.http = http;
    }
    async call(userId, path, method, body) {
        if (!path.startsWith('/sell/inventory/v1/'))
            throw new DomainError('ebay_path_invalid', 'Unsupported inventory resource.');
        if (this.cfg.environment === 'production' && !this.cfg.productionApproved)
            throw new DomainError('ebay_production_disabled', 'Production eBay writes are disabled.', 503);
        const r = await this.http(base(this.cfg.environment) + path, { method, headers: { Authorization: 'Bearer ' + await this.getToken(userId), 'Content-Type': 'application/json', 'Content-Language': 'en-US' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!r.ok)
            throw new DomainError(r.status >= 500 ? 'ebay_outcome_ambiguous' : 'ebay_rejected', 'eBay listing operation needs review.', 502);
        if (r.status === 204)
            return {};
        return await r.json();
    }
}
export async function createCrossListingDraft(pool, userId, internalListingId, comicId, key) {
    return serializable(pool, db => once(db, key, 'ebay_draft', { userId, internalListingId, comicId }, async () => {
        const listing = (await db.query('SELECT * FROM ch_platform.marketplace_listings WHERE id=$1 FOR UPDATE', [internalListingId])).rows[0];
        if (!listing || listing.seller_id !== userId || listing.comic_id !== comicId)
            throw new DomainError('listing_missing', 'Owned listing not found.', 404);
        if (listing.is_custom_entry || listing.sale_mode !== 'fixed' || !['draft', 'active'].includes(listing.status))
            throw new DomainError('ebay_listing_not_eligible', 'Use a reviewed fixed-price listing.');
        const row = (await db.query(`INSERT INTO ch_platform.ebay_listings(user_id,internal_listing_id,comic_id,ebay_sku)
   VALUES($1,$2,$3,$4) ON CONFLICT(internal_listing_id) DO UPDATE SET internal_listing_id=EXCLUDED.internal_listing_id RETURNING id,ebay_sku`, [userId, internalListingId, comicId, 'CH-' + internalListingId])).rows[0];
        return { mappingId: row.id, sku: row.ebay_sku, status: 'draft' };
    }));
}
export async function executeEbayOperation(pool, client, userId, mappingId, operation, draft, key, approvedHash) {
    const hash = await sha256(canonicalJson(draft));
    const reservation = await serializable(pool, async (db) => {
        const listing = (await db.query('SELECT * FROM ch_platform.ebay_listings WHERE id=$1 FOR UPDATE', [mappingId])).rows[0];
        if (!listing || listing.user_id !== userId || listing.ebay_sku !== draft.sku)
            throw new DomainError('ebay_mapping_missing', 'eBay draft does not match the owned listing.', 404);
        if (listing.draft_hash !== hash)
            throw new DomainError('untrusted_draft', 'Assemble this exact draft on the server before using it.');
        const inFlight = (await db.query("SELECT idempotency_key FROM ch_platform.ebay_operations WHERE listing_id=$1 AND status IN ('sent','ambiguous') AND idempotency_key<>$2 LIMIT 1", [mappingId, key])).rows[0];
        if (inFlight)
            throw new DomainError('ebay_reconcile_required', 'A prior operation must be reconciled.');
        const previous = (await db.query('SELECT * FROM ch_platform.ebay_operations WHERE idempotency_key=$1 FOR UPDATE', [key])).rows[0];
        if (previous) {
            if (previous.request_hash !== hash || previous.operation !== operation || previous.listing_id !== mappingId)
                throw new DomainError('ebay_operation_reused', 'Operation input changed.');
            if (previous.status === 'confirmed')
                return { listing, replay: previous.result };
            throw new DomainError('ebay_reconcile_required', 'Reconcile this existing eBay operation before retrying.');
        }
        if (!listing.draft_created_at || Date.parse(listing.draft_created_at) < Date.now() - 30 * 60000 || listing.draft_inventory_hash !== await inventoryFingerprint(db, listing.internal_listing_id))
            throw new DomainError('ebay_inventory_changed', 'Inventory/evidence changed or the draft expired. Rebuild it.');
        if (operation === 'create_offer' && (listing.status !== 'draft' || !(await db.query("SELECT idempotency_key FROM ch_platform.ebay_operations WHERE listing_id=$1 AND operation='upsert_inventory' AND request_hash=$2 AND status='confirmed' LIMIT 1", [mappingId, hash])).rows.length))
            throw new DomainError('inventory_not_ready', 'Save this exact inventory item before creating an offer.');
        if (operation === 'upsert_inventory' && listing.status !== 'draft')
            throw new DomainError('draft_not_editable', 'Reconcile or end the existing offer before changing inventory.');
        if (operation !== 'upsert_inventory')
            await listingVerificationGate(db, listing.internal_listing_id, userId, '50000');
        const internal = (await db.query('SELECT asking_price_cents,status FROM ch_platform.marketplace_listings WHERE id=$1 FOR UPDATE', [listing.internal_listing_id])).rows[0];
        if (!internal || !['draft', 'active'].includes(internal.status) || amountString(cents(internal.asking_price_cents)) !== draft.offer.pricingSummary.price.value || draft.offer.availableQuantity !== 1 || draft.inventory.availability.shipToLocationAvailability.quantity !== 1)
            throw new DomainError('ebay_draft_changed', 'Rebuild this draft from current inventory and seller price.');
        if (operation === 'publish' && (approvedHash !== hash || !listing.ebay_offer_id || listing.status !== 'unpublished_offer'))
            throw new DomainError('ebay_publish_approval_required', 'Approve the exact complete draft before publishing.');
        await db.query('INSERT INTO ch_platform.ebay_operations(idempotency_key,listing_id,operation,request_hash,status) VALUES($1,$2,$3,$4,\'sent\')', [key, mappingId, operation, hash]);
        await db.query('UPDATE ch_platform.ebay_listings SET status=$2 WHERE id=$1', [mappingId, operation === 'publish' ? 'publish_pending' : 'draft_pending']);
        return { listing, replay: null };
    });
    if (reservation.replay)
        return reservation.replay;
    let result;
    try {
        const l = reservation.listing;
        if (operation === 'upsert_inventory')
            result = await client.call(userId, '/sell/inventory/v1/inventory_item/' + encodeURIComponent(draft.sku), 'PUT', draft.inventory);
        else if (operation === 'create_offer')
            result = await client.call(userId, '/sell/inventory/v1/offer', 'POST', draft.offer);
        else
            result = await client.call(userId, '/sell/inventory/v1/offer/' + encodeURIComponent(l.ebay_offer_id) + '/publish', 'POST');
        if (operation === 'create_offer' && typeof result.offerId !== 'string')
            throw new DomainError('ebay_outcome_ambiguous', 'eBay offer identity was not returned.');
        if (operation === 'publish' && typeof result.listingId !== 'string')
            throw new DomainError('ebay_outcome_ambiguous', 'eBay live listing identity was not returned.');
    }
    catch (error) {
        await serializable(pool, async (db) => {
            const definite = error instanceof DomainError && error.code === 'ebay_rejected';
            await db.query('UPDATE ch_platform.ebay_operations SET status=$2 WHERE idempotency_key=$1', [key, definite ? 'failed' : 'ambiguous']);
            await db.query('UPDATE ch_platform.ebay_listings SET status=$2 WHERE id=$1', [mappingId, definite ? 'error' : 'needs_reconciliation']);
        });
        throw error;
    }
    await serializable(pool, async (db) => {
        await db.query('UPDATE ch_platform.ebay_operations SET status=\'confirmed\',result=$2::jsonb WHERE idempotency_key=$1', [key, JSON.stringify(result)]);
        await db.query(`UPDATE ch_platform.ebay_listings SET status=$2,ebay_offer_id=coalesce($3,ebay_offer_id),ebay_listing_id=coalesce($4,ebay_listing_id),last_synced_at=now() WHERE id=$1`, [mappingId, operation === 'publish' ? 'live' : operation === 'create_offer' ? 'unpublished_offer' : 'draft', result.offerId || null, result.listingId || null]);
    });
    return { ...result, approvedPayloadHash: hash };
}
export async function reconcileAmbiguousOffer(pool, client, userId, mappingId) {
    const db = await pool.connect();
    let mapping;
    try {
        mapping = (await db.query('SELECT user_id,ebay_sku FROM ch_platform.ebay_listings WHERE id=$1', [mappingId])).rows[0];
    }
    finally {
        db.release();
    }
    if (mapping?.user_id !== userId)
        throw new DomainError('ebay_mapping_missing', 'Owned eBay mapping not found.', 404);
    const response = await client.call(userId, '/sell/inventory/v1/offer?' + new URLSearchParams({ sku: mapping.ebay_sku, format: 'FIXED_PRICE' }), 'GET');
    const parsed = z.object({ offers: z.array(z.object({ offerId: z.string(), listing: z.object({ listingId: z.string(), listingStatus: z.string() }).optional() })).optional() }).parse(response);
    if (parsed.offers?.length !== 1)
        throw new DomainError('ebay_reconcile_ambiguous', 'An operator must reconcile zero or multiple matching offers.');
    const offer = parsed.offers[0];
    await serializable(pool, async (db) => {
        await db.query('UPDATE ch_platform.ebay_listings SET ebay_offer_id=$2,ebay_listing_id=$3,status=$4,last_synced_at=now() WHERE id=$1', [mappingId, offer.offerId, offer.listing?.listingId || null, offer.listing?.listingStatus === 'ACTIVE' ? 'live' : offer.listing?.listingStatus === 'ENDED' ? 'ended' : 'unpublished_offer']);
        await db.query("UPDATE ch_platform.ebay_operations SET status='confirmed',result=$2::jsonb WHERE listing_id=$1 AND status='ambiguous' AND (operation='create_offer' OR(operation='publish' AND $3))", [mappingId, JSON.stringify(offer), offer.listing?.listingStatus === 'ACTIVE' || offer.listing?.listingStatus === 'ENDED']);
    });
    return offer;
}
