import { sha256, canonicalJson } from './db.js';
export async function inventoryFingerprint(db, listingId) {
    const rows = (await db.query(`SELECT p.id,p.comic_id,p.grade_key,p.certification_number,p.condition_notes,p.status,c.metadata_status,c.printing_type,c.variant_code,c.version,
  coalesce((SELECT jsonb_agg(jsonb_build_object('hash',photo.sha256,'url',photo.url,'scan',photo.scan_id,'disposition',scan.disposition) ORDER BY photo.id)
   FROM ch_platform.listing_photos photo LEFT JOIN ch_platform.ai_authenticity_scans scan ON scan.id=photo.scan_id WHERE photo.listing_id=$1 AND photo.collection_item_id=p.id),'[]'::jsonb) AS photos
  FROM ch_platform.listing_items li JOIN ch_platform.collection_items p ON p.id=li.collection_item_id JOIN ch_platform.comics c ON c.id=p.comic_id WHERE li.listing_id=$1 ORDER BY p.id`, [listingId])).rows;
    return sha256(canonicalJson(rows));
}
