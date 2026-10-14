import { DomainError, canonicalJson, serializable, sha256 } from './db.js';
export async function saveValuation(pool, comicId, gradeKey, quote, windowStart, windowEnd) {
    if (quote.kind === 'unavailable' || !quote.asOf || quote.sourceIds.length === 0 || !quote.lowCents || !quote.highCents)
        throw new DomainError('valuation_unqualified', 'Only qualified estimates or explicitly labeled asking ranges can be saved.');
    const hash = await sha256(canonicalJson({ comicId, gradeKey, quote, windowStart, windowEnd }));
    return serializable(pool, async (db) => {
        const comic = (await db.query('SELECT metadata_status,printing_type FROM ch_platform.comics WHERE id=$1', [comicId])).rows[0];
        if (comic?.metadata_status !== 'canonical' || comic.printing_type === 'unknown' || gradeKey === 'raw_unknown')
            throw new DomainError('exact_edition_required', 'Verified edition and known grade are required.');
        const sources = (await db.query(`SELECT id,kind,license_reference FROM ch_platform.data_sources
   WHERE id=ANY($1::text[]) AND enabled AND display_rights AND license_reference IS NOT NULL AND(license_expires_at IS NULL OR license_expires_at>now()) FOR SHARE`, [quote.sourceIds])).rows;
        if (sources.length !== new Set(quote.sourceIds).size || sources.some(s => quote.kind === 'asking_range' ? s.kind !== 'asking' : quote.kind === 'licensed_fmv' ? s.kind !== 'licensed_fmv' : s.kind !== 'sold'))
            throw new DomainError('valuation_source_unlicensed', 'Every contributing source must have current compatible display rights.');
        const prior = (await db.query('SELECT id FROM ch_platform.fmv_records WHERE comic_id=$1 AND grade_key=$2 AND evidence_hash=$3', [comicId, gradeKey, hash])).rows[0];
        if (prior)
            return prior;
        const row = (await db.query(`INSERT INTO ch_platform.fmv_records(comic_id,grade_key,source_id,quote_kind,value_cents,low_cents,high_cents,sample_count,observed_at,window_start,window_end,methodology,confidence,rights_reference,evidence_hash)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, [comicId, gradeKey, sources[0].id, quote.kind, quote.valueCents, quote.lowCents, quote.highCents, quote.sampleCount, quote.asOf, windowStart, windowEnd, quote.methodology, quote.confidence, sources[0].license_reference, hash])).rows[0];
        for (const source of sources)
            await db.query('INSERT INTO ch_platform.fmv_record_sources(record_id,source_id,rights_reference) VALUES($1,$2,$3)', [row.id, source.id, source.license_reference]);
        return row;
    });
}
