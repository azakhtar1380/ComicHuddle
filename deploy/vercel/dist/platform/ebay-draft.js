import { DomainError, canonicalJson, serializable, sha256 } from './db.js';
import { buildEbayDraft } from './ebay.js';
import { aggregateCollection } from './fmv.js';
import { inventoryFingerprint } from './inventory-fingerprint.js';
import { listingVerificationGate } from './scans.js';
// Called by the BFF with server-resolved category metadata, policy IDs, licensed
// quotes and uploaded CDN assets. The browser never supplies this payload.
export async function assembleEbayDraft(pool, userId, mappingId, setup, quoteFor) {
    const db = await pool.connect();
    let listing;
    let initialFingerprint = '';
    let copies = [];
    try {
        listing = (await db.query(`SELECT e.ebay_sku,e.internal_listing_id,l.asking_price_cents FROM ch_platform.ebay_listings e
   JOIN ch_platform.marketplace_listings l ON l.id=e.internal_listing_id WHERE e.id=$1 AND e.user_id=$2 AND e.status='draft'`, [mappingId, userId])).rows[0];
        if (!listing)
            throw new DomainError('draft_missing', 'An owned editable draft is required.', 404);
        copies = (await db.query(`SELECT p.id,p.comic_id,p.grade_key,p.certification_number AS cert_number,p.condition_notes,s.title,c.issue_number,pub.name AS publisher,s.start_year,c.printing_type,c.variant_code
   FROM ch_platform.listing_items li JOIN ch_platform.collection_items p ON p.id=li.collection_item_id JOIN ch_platform.comics c ON c.id=p.comic_id
   JOIN ch_platform.series s ON s.id=c.series_id JOIN ch_platform.publishers pub ON pub.id=s.publisher_id WHERE li.listing_id=$1 ORDER BY p.id`, [listing.internal_listing_id])).rows;
        initialFingerprint = await inventoryFingerprint(db, listing.internal_listing_id);
    }
    finally {
        db.release();
    }
    if (!copies.length)
        throw new DomainError('draft_empty', 'Add exact physical copies.');
    const quotes = await Promise.all(copies.map(async (c) => ({ copyId: c.id, valuation: await quoteFor(c.comic_id, c.grade_key) })));
    const aggregate = aggregateCollection(quotes);
    const valuation = copies.length === 1 ? quotes[0].valuation : { kind: aggregate.complete ? 'sold_estimate' : 'unavailable', valueCents: aggregate.totalFMVCents, lowCents: null, highCents: null, sampleCount: quotes.reduce((n, c) => n + c.valuation.sampleCount, 0), coverage: aggregate.coveredCopies + '/' + aggregate.totalCopies + ' copies', confidence: 'low', asOf: quotes.map(c => c.valuation.asOf).filter((s) => !!s).sort()[0] || null, sourceIds: [...new Set(quotes.flatMap(c => c.valuation.sourceIds))], methodology: 'Sum of exact-edition estimates; no bundle-sale premium inferred.', warnings: [] };
    return serializable(pool, async (tx) => {
        const mapping = (await tx.query('SELECT * FROM ch_platform.ebay_listings WHERE id=$1 AND user_id=$2 FOR UPDATE', [mappingId, userId])).rows[0];
        if (!mapping || mapping.status !== 'draft' || mapping.ebay_sku !== listing.ebay_sku)
            throw new DomainError('draft_changed', 'Reload the draft.');
        const current = (await tx.query('SELECT asking_price_cents FROM ch_platform.marketplace_listings WHERE id=$1 FOR UPDATE', [mapping.internal_listing_id])).rows[0];
        if (current.asking_price_cents !== listing.asking_price_cents)
            throw new DomainError('draft_price_changed', 'Rebuild with the current asking price.');
        if (initialFingerprint !== await inventoryFingerprint(tx, mapping.internal_listing_id))
            throw new DomainError('draft_inventory_changed', 'Inventory changed during valuation. Rebuild this draft.');
        const gate = await listingVerificationGate(tx, mapping.internal_listing_id, userId, '50000');
        const photos = (await tx.query('SELECT url FROM ch_platform.listing_photos WHERE listing_id=$1 ORDER BY CASE WHEN kind=\'cover\' THEN 0 ELSE 1 END,id LIMIT 12', [mapping.internal_listing_id])).rows.map(p => p.url);
        const first = copies[0], many = copies.length > 1;
        const metadata = { title: many ? `Collection of ${copies.length} comics — ${copies.map(c => c.title + ' #' + c.issue_number).join(', ')}` : first.title,
            issueNumber: many ? 'Lot' : first.issue_number, publisher: [...new Set(copies.map(c => c.publisher))].join(', '), characters: [], gradeLabel: many ? 'Mixed conditions' : first.grade_key,
            era: many ? 'Mixed eras' : String(first.start_year), printingLabel: many ? 'See individual edition details' : first.printing_type, variantLabel: many ? 'Mixed editions' : first.variant_code,
            conditionDescription: copies.map(c => c.title + ' #' + c.issue_number + '; ' + c.printing_type + '; ' + c.variant_code + '; ' + c.grade_key + '; ' + c.condition_notes).join('\n'),
            physicalInspection: gate.authenticityClaimAllowed, certNumber: many ? undefined : first.cert_number || undefined };
        const draft = buildEbayDraft({ sku: mapping.ebay_sku, metadata, valuation, askingCents: current.asking_price_cents, images: photos, ...setup });
        const hash = await sha256(canonicalJson(draft));
        await tx.query('UPDATE ch_platform.ebay_listings SET draft_payload=$2::jsonb,draft_hash=$3,draft_inventory_hash=$6,draft_created_at=now(),baseline_fmv_cents=$4,baseline_kind=$5 WHERE id=$1', [mappingId, JSON.stringify(draft), hash, valuation.valueCents, valuation.kind === 'unavailable' ? null : valuation.kind, await inventoryFingerprint(tx, mapping.internal_listing_id)]);
        return { draft, approvedPayloadHash: hash };
    });
}
