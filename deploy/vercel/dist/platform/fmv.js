import { DomainError, serializable } from './db.js';
import { cents, decimalToCents } from './money.js';
export const defaultSources = Object.fromEntries(['ebay_insights', 'licensed_feed', 'internal_platform', 'ebay_browse'].map(id => [id, { enabled: false, displayRights: false, licenseReference: null, licenseExpiresAt: null, maxAgeDays: 30 }]));
const eligible = (p, now) => p.enabled && p.displayRights && !!p.licenseReference && (!p.licenseExpiresAt || Date.parse(p.licenseExpiresAt) > now.getTime());
const fresh = (at, days, now) => Number.isFinite(Date.parse(at)) && Date.parse(at) <= now.getTime() && Date.parse(at) >= now.getTime() - days * 86400000;
const unavailable = (warnings) => ({ kind: 'unavailable', valueCents: null, lowCents: null, highCents: null, sampleCount: 0, coverage: 'No qualified baseline', confidence: 'low', asOf: null, sourceIds: [], methodology: 'No estimate', warnings });
export function trimmedMean(values, trimFraction = .1) {
    if (values.length === 0 || !Number.isFinite(trimFraction) || trimFraction < 0 || trimFraction >= .5)
        throw new DomainError('invalid_estimator', 'Invalid trimmed-mean inputs.', 400);
    values.forEach(cents);
    const sorted = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const trim = Math.floor(sorted.length * trimFraction), kept = sorted.slice(trim, sorted.length - trim);
    const sum = kept.reduce((a, b) => a + b, BigInt(0)), count = BigInt(kept.length);
    return (sum + count / BigInt(2)) / count;
}
export async function estimateFMV(request, adapters, config, options = {}) {
    const now = options.now || new Date(), minimum = options.minimumSales ?? 5;
    if (!adapters.every(a => Object.prototype.hasOwnProperty.call(config, a.id)) || new Set(adapters.map(a => a.id)).size !== adapters.length)
        throw new DomainError('invalid_adapters', 'Use distinct configured source adapters.', 400);
    if (request.gradeKey === 'raw_unknown' || request.printingType === 'unknown')
        return unavailable(['Choose an exact edition and known condition/grade.']);
    if (!Number.isInteger(minimum) || minimum < 3 || request.windowDays < 1 || request.windowDays > 366)
        throw new DomainError('invalid_valuation_policy', 'Invalid sample/window policy.', 400);
    const warnings = [], all = [];
    const enabled = adapters.filter(a => eligible(config[a.id], now));
    const results = await Promise.allSettled(enabled.map(async (a) => ({ adapter: a, evidence: await a.fetch(request, options.signal) })));
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            const rows = r.value.evidence;
            if (!Array.isArray(rows) || rows.length > 10000) {
                warnings.push(enabled[i].id + ': response exceeds policy limit.');
                return;
            }
            for (const e of rows) {
                if (!e || typeof e !== 'object')
                    continue;
                if (e.source !== enabled[i].id || e.comicId !== request.comicId || e.gradeKey !== request.gradeKey || e.currency !== 'USD')
                    continue;
                if ((e.kind === 'sold' && !['ebay_insights', 'internal_platform'].includes(e.source)) || (e.kind === 'licensed_fmv' && e.source !== 'licensed_feed') || (e.kind === 'asking' && e.source !== 'ebay_browse'))
                    continue;
                try {
                    if (cents(e.priceCents) > BigInt(0))
                        all.push(e);
                }
                catch {
                    warnings.push(enabled[i].id + ': malformed price excluded.');
                }
            }
        }
        else
            warnings.push(enabled[i].id + ': source unavailable.');
    });
    const sold = all.filter((e) => e.kind === 'sold' && e.verified === true && e.isBundle === false && typeof e.externalSaleId === 'string' && e.externalSaleId.length <= 256 && (!e.bestOfferAccepted || e.actualAcceptedPriceKnown) && fresh(e.soldAt, Math.min(request.windowDays, config[e.source].maxAgeDays), now));
    const unique = new Map(), conflicts = new Set();
    for (const sale of sold) {
        // Source adapters normalize the same sale to the same canonical ID, e.g. ebay:<transactionId>.
        if (!sale.externalSaleId || conflicts.has(sale.externalSaleId))
            continue;
        const prior = unique.get(sale.externalSaleId);
        if (prior && prior.priceCents !== sale.priceCents) {
            warnings.push('Conflicting sale ' + sale.externalSaleId + ' excluded.');
            unique.delete(sale.externalSaleId);
            conflicts.add(sale.externalSaleId);
            continue;
        }
        if (!prior)
            unique.set(sale.externalSaleId, sale);
    }
    const comps = [...unique.values()];
    if (comps.length >= minimum) {
        const values = comps.map(e => cents(e.priceCents)).sort((a, b) => a < b ? -1 : 1), trim = options.trimFraction ?? .1;
        const value = trimmedMean(values, trim), n = Math.floor(values.length * trim), kept = values.slice(n, values.length - n);
        return { kind: 'sold_estimate', valueCents: value.toString(), lowCents: kept[0].toString(), highCents: kept[kept.length - 1].toString(), sampleCount: comps.length,
            coverage: 'Exact edition + exact condition/grade', confidence: comps.length >= 20 ? 'high' : 'medium', asOf: comps.map(e => e.soldAt).sort().at(-1) || null,
            sourceIds: [...new Set(comps.map(e => e.source))], methodology: `${Math.round(trim * 100)}% trimmed mean per tail; ${request.windowDays}-day requested window; merchandise price excludes shipping/tax.`, warnings };
    }
    if (comps.length)
        warnings.push(`Only ${comps.length} qualified completed sales; minimum is ${minimum}.`);
    const licensed = all.filter((e) => e.kind === 'licensed_fmv' && Number.isInteger(e.sampleCount) && e.sampleCount >= minimum && fresh(e.observedAt, config[e.source].maxAgeDays, now)).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
    if (licensed[0]) {
        const q = licensed[0];
        return { kind: 'licensed_fmv', valueCents: q.priceCents, lowCents: q.priceCents, highCents: q.priceCents, sampleCount: q.sampleCount, coverage: 'Licensed provider estimate', confidence: 'medium', asOf: q.observedAt, sourceIds: ['licensed_feed'], methodology: q.methodology, warnings };
    }
    const asking = all.filter((e) => e.kind === 'asking' && e.editionConfirmed && fresh(e.observedAt, Math.min(1, config[e.source].maxAgeDays), now));
    if (asking.length) {
        const values = asking.map(e => cents(e.priceCents)).sort((a, b) => a < b ? -1 : 1);
        return { kind: 'asking_range', valueCents: null, lowCents: values[0].toString(), highCents: values.at(-1).toString(), sampleCount: asking.length, coverage: 'Active asking prices only', confidence: 'low', asOf: asking.map(e => e.observedAt).sort().at(-1), sourceIds: ['ebay_browse'], methodology: 'Active listings are not completed sales or FMV.', warnings: [...warnings, 'Asking prices do not establish market value.'] };
    }
    return unavailable(warnings.length ? warnings : ['No enabled, licensed, qualified valuation source.']);
}
export function priceVarianceAlert(askingCents, quote, thresholdBps = 2000) {
    const asking = cents(askingCents);
    if (!['sold_estimate', 'licensed_fmv'].includes(quote.kind) || !quote.valueCents)
        return { rating: 'No comparable FMV', varianceBps: null, flag: false, warning: 'No verified price baseline. Verify edition, condition and seller independently.' };
    const baseline = cents(quote.valueCents);
    if (baseline === BigInt(0))
        throw new DomainError('zero_baseline', 'Zero is not an FMV baseline.');
    if (!Number.isInteger(thresholdBps) || thresholdBps < 0)
        throw new DomainError('invalid_threshold', 'Choose a nonnegative integer threshold.', 400);
    const numerator = (asking - baseline) * BigInt(10000), limit = baseline * BigInt(thresholdBps), variance = numerator / baseline;
    return { rating: numerator < -limit ? 'Below estimate' : numerator > limit ? 'Above estimate' : 'Near estimate', varianceBps: Number(variance), flag: numerator > limit || numerator < -limit, warning: 'Price variance is not proof of authenticity or seller safety.' };
}
export function aggregateCollection(lines) {
    const seen = new Set();
    let subtotal = BigInt(0), covered = 0;
    for (const line of lines) {
        if (seen.has(line.copyId))
            throw new DomainError('duplicate_physical_copy', 'Collection contains the same physical copy twice.', 400);
        seen.add(line.copyId);
        if (['sold_estimate', 'licensed_fmv'].includes(line.valuation.kind) && line.valuation.valueCents) {
            subtotal += cents(line.valuation.valueCents);
            covered++;
        }
    }
    return { totalFMVCents: covered === lines.length && lines.length > 0 ? cents(subtotal).toString() : null, pricedSubtotalCents: cents(subtotal).toString(), coveredCopies: covered, totalCopies: lines.length, complete: lines.length > 0 && covered === lines.length };
}
export class InternalPlatformAdapter {
    db;
    id = 'internal_platform';
    constructor(db) {
        this.db = db;
    }
    async fetch(r) {
        const rows = (await this.db.query(`SELECT o.id,i.comic_id,i.grade_key,(o.subtotal_cents-o.discount_cents)::text AS price,o.confirmed_delivery_at::text AS at
   FROM ch_platform.orders o JOIN ch_platform.order_items i ON i.order_id=o.id WHERE i.comic_id=$1 AND i.grade_key=$2
   AND o.status='fulfilled' AND NOT o.dispute_open AND o.currency='USD' AND o.confirmed_delivery_at IS NOT NULL
   AND o.confirmed_delivery_at>=now()-($3::integer*interval '1 day')
   AND (SELECT count(*) FROM ch_platform.order_items x WHERE x.order_id=o.id)=1 LIMIT 1000`, [r.comicId, r.gradeKey, r.windowDays])).rows;
        return rows.map(e => ({ kind: 'sold', source: this.id, externalSaleId: 'platform:' + e.id, comicId: e.comic_id, gradeKey: e.grade_key, currency: 'USD', priceCents: e.price, soldAt: e.at, verified: true, isBundle: false, bestOfferAccepted: false, actualAcceptedPriceKnown: true, sourceUrl: 'platform:order:' + e.id }));
    }
}
// Restricted API: plug in the contract supplied by eBay after access approval.
// No invented public Insights URL or scrape-based sold-data substitute.
export class EbayMarketplaceInsightsAdapter {
    approvedClient;
    id = 'ebay_insights';
    constructor(approvedClient) {
        this.approvedClient = approvedClient;
    }
    async fetch(r, signal) { if (!this.approvedClient)
        throw new DomainError('insights_access_missing', 'Official Marketplace Insights access is not configured.', 503); return this.approvedClient.fetchExactSoldComps(r, signal); }
}
export class LicensedFeedAdapter {
    client;
    id = 'licensed_feed';
    constructor(client) {
        this.client = client;
    }
    async fetch(r, signal) { if (!this.client)
        throw new DomainError('licensed_feed_missing', 'Licensed feed contract is not configured.', 503); return this.client.fetchLicensedQuotes(r, signal); }
}
export class EbayBrowseFallbackAdapter {
    getApplicationToken;
    confirmEdition;
    http;
    sandbox;
    id = 'ebay_browse';
    constructor(getApplicationToken, confirmEdition, http = fetch, sandbox = false) {
        this.getApplicationToken = getApplicationToken;
        this.confirmEdition = confirmEdition;
        this.http = http;
        this.sandbox = sandbox;
    }
    async fetch(r, signal) {
        const url = new URL((this.sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com') + '/buy/browse/v1/item_summary/search');
        url.search = new URLSearchParams({ q: (r.title + ' #' + r.issueNumber + ' ' + r.variantCode).slice(0, 100), limit: '50', offset: '0', filter: 'buyingOptions:{FIXED_PRICE}' }).toString();
        const res = await this.http(url, { headers: { Authorization: 'Bearer ' + await this.getApplicationToken(), 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' }, redirect: 'error', signal: signal || AbortSignal.timeout(15000) });
        if (!res.ok)
            throw new DomainError('browse_unavailable', 'eBay Browse access/rate limit unavailable.', 503);
        const body = await res.json();
        if (!Array.isArray(body.itemSummaries) || body.itemSummaries.length > 200)
            return [];
        const rows = [];
        for (const item of body.itemSummaries) {
            if (item.price?.currency !== 'USD')
                continue;
            const confirmed = await this.confirmEdition(item, r);
            if (!confirmed)
                continue;
            try {
                rows.push({ kind: 'asking', source: this.id, externalListingId: item.itemId, comicId: r.comicId, gradeKey: r.gradeKey, currency: 'USD', priceCents: decimalToCents(item.price.value).toString(), observedAt: new Date().toISOString(), editionConfirmed: true, sourceUrl: item.itemWebUrl });
            }
            catch { }
        }
        return rows;
    }
}
export async function updateSourcePolicy(pool, adminUserId, source, expectedVersion, policy) {
    return serializable(pool, async (db) => {
        const user = (await db.query('SELECT role FROM ch_platform.users WHERE id=$1', [adminUserId])).rows[0];
        if (user?.role !== 'admin')
            throw new DomainError('forbidden', 'Administrator access is required.', 403);
        if (policy.enabled && !eligible(policy, new Date()))
            throw new DomainError('source_rights_missing', 'Active display rights and a license reference are required.');
        if (!Number.isInteger(policy.maxAgeDays) || policy.maxAgeDays < 1 || policy.maxAgeDays > 366)
            throw new DomainError('invalid_freshness', 'Invalid freshness window.', 400);
        const result = await db.query(`UPDATE ch_platform.data_sources SET enabled=$3,display_rights=$4,license_reference=$5,license_expires_at=$6,max_age_days=$7,updated_by=$8,version=version+1
   WHERE id=$1 AND version=$2 RETURNING version`, [source, expectedVersion, policy.enabled, policy.displayRights, policy.licenseReference, policy.licenseExpiresAt, policy.maxAgeDays, adminUserId]);
        if (!result.rows[0])
            throw new DomainError('policy_changed', 'Reload source settings before changing them.');
        return result.rows[0];
    });
}
export async function analyzeMarketplaceDeal(db, listingId, quoteFor) {
    const listing = (await db.query('SELECT asking_price_cents,is_custom_entry FROM ch_platform.marketplace_listings WHERE id=$1 AND status=\'active\'', [listingId])).rows[0];
    if (!listing)
        throw new DomainError('listing_missing', 'Active listing not found.', 404);
    const items = (await db.query(`SELECT i.collection_item_id,i.comic_id,c.grade_key FROM ch_platform.listing_items i JOIN ch_platform.collection_items c ON c.id=i.collection_item_id WHERE i.listing_id=$1`, [listingId])).rows;
    const lines = await Promise.all(items.map(async (item) => ({ copyId: item.collection_item_id, valuation: await quoteFor(item.comic_id, item.grade_key) })));
    const aggregate = aggregateCollection(lines);
    const quote = aggregate.totalFMVCents ? { kind: 'sold_estimate', valueCents: aggregate.totalFMVCents, lowCents: aggregate.totalFMVCents, highCents: aggregate.totalFMVCents, sampleCount: lines.reduce((sum, l) => sum + l.valuation.sampleCount, 0), coverage: 'All copies priced', confidence: 'medium', asOf: null, sourceIds: [], methodology: 'Sum of exact-edition estimates', warnings: [] } : unavailable(['Collection coverage is incomplete.']);
    return { listingId, askingPriceCents: listing.asking_price_cents, collection: aggregate, priceComparison: priceVarianceAlert(listing.asking_price_cents, quote), customEntry: listing.is_custom_entry };
}
