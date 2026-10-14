import { DomainError, once, serializable } from './db.js';
// Every custom comic still has a central ID: a provisional directory record.
// Provisional IDs cannot be purchased, valued, or cross-listed as verified keys.
export async function submitCustomComic(pool, userId, input, key) {
    if (!input.issueNumber.trim() || input.issueNumber.length > 50 || input.variantCode.length > 100 || input.notes.length > 2000)
        throw new DomainError('custom_input_invalid', 'Check the issue, edition and evidence fields.', 400);
    const url = new URL(input.evidenceUrl);
    if (url.protocol !== 'https:' || url.username || url.password)
        throw new DomainError('evidence_url_invalid', 'HTTPS evidence is required.', 400);
    return serializable(pool, db => once(db, key, 'custom_comic', { userId, input }, async () => {
        const comic = (await db.query(`INSERT INTO ch_platform.comics(series_id,issue_number,printing_type,variant_code,metadata_status,created_by,source,source_url,attribution,license_name)
   VALUES($1,$2,$3,$4,'provisional',$5,'user_submission',$6,'User-submitted metadata; unverified','Pending review') RETURNING id`, [input.seriesId, input.issueNumber, input.printingType, input.variantCode, userId, url.href])).rows[0];
        const review = (await db.query('INSERT INTO ch_platform.catalog_moderation(comic_id,submitted_by,evidence) VALUES($1,$2,$3::jsonb) RETURNING id', [comic.id, userId, JSON.stringify({ evidenceUrl: url.href, notes: input.notes })])).rows[0];
        return { comicId: comic.id, reviewId: review.id, status: 'pending' };
    }));
}
export async function reviewCustomComic(pool, adminId, reviewId, decision, key) {
    return serializable(pool, db => once(db, key, 'moderate_comic', { adminId, reviewId, decision }, async () => {
        const admin = (await db.query('SELECT role FROM ch_platform.users WHERE id=$1', [adminId])).rows[0];
        if (admin?.role !== 'admin')
            throw new DomainError('forbidden', 'Administrator access is required.', 403);
        const review = (await db.query('SELECT * FROM ch_platform.catalog_moderation WHERE id=$1 FOR UPDATE', [reviewId])).rows[0];
        if (!review || review.status !== 'pending')
            throw new DomainError('review_closed', 'Pending directory review is required.');
        if (decision.kind === 'verify') {
            if (!decision.attribution.trim() || !decision.licenseName.trim() || new URL(decision.sourceUrl).protocol !== 'https:')
                throw new DomainError('metadata_rights_required', 'Verified provenance and metadata rights must be recorded.');
            await db.query("UPDATE ch_platform.comics SET metadata_status='canonical',source_url=$2,attribution=$3,license_name=$4,version=version+1 WHERE id=$1 AND metadata_status='provisional'", [review.comic_id, decision.sourceUrl, decision.attribution, decision.licenseName]);
        }
        else if (decision.kind === 'merge') {
            const target = (await db.query("SELECT id FROM ch_platform.comics WHERE id=$1 AND metadata_status='canonical' FOR UPDATE", [decision.canonicalComicId])).rows[0];
            if (!target || decision.canonicalComicId === review.comic_id)
                throw new DomainError('merge_target_invalid', 'Select a different canonical exact edition.');
            // Orders retain their original immutable evidence IDs; the old comic becomes
            // a permanent alias. Future collections/listings use the canonical ID.
            await db.query('SET CONSTRAINTS ALL DEFERRED');
            await db.query('UPDATE ch_platform.collection_items SET comic_id=$2 WHERE comic_id=$1', [review.comic_id, decision.canonicalComicId]);
            await db.query('UPDATE ch_platform.listing_items SET comic_id=$2 WHERE comic_id=$1', [review.comic_id, decision.canonicalComicId]);
            await db.query('UPDATE ch_platform.marketplace_listings SET comic_id=$2 WHERE comic_id=$1', [review.comic_id, decision.canonicalComicId]);
            await db.query("UPDATE ch_platform.comics SET metadata_status='aliased',alias_of=$2,version=version+1 WHERE id=$1", [review.comic_id, decision.canonicalComicId]);
        }
        if (decision.kind !== 'reject')
            await db.query(`UPDATE ch_platform.marketplace_listings l SET is_custom_entry=EXISTS(SELECT 1 FROM ch_platform.listing_items i JOIN ch_platform.comics c ON c.id=i.comic_id WHERE i.listing_id=l.id AND c.metadata_status<>'canonical'),version=version+1
   WHERE l.id IN (SELECT listing_id FROM ch_platform.listing_items WHERE comic_id=$1)`, [decision.kind === 'merge' ? decision.canonicalComicId : review.comic_id]);
        await db.query('UPDATE ch_platform.catalog_moderation SET status=$2,reviewed_by=$3,canonical_comic_id=$4,review_notes=$5,reviewed_at=now() WHERE id=$1', [reviewId, decision.kind === 'verify' ? 'verified' : decision.kind === 'merge' ? 'merged' : 'rejected', adminId, decision.kind === 'merge' ? decision.canonicalComicId : null, decision.kind === 'reject' ? decision.reason.slice(0, 2000) : null]);
        return { reviewId, status: decision.kind };
    }));
}
