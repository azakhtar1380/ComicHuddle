import {DomainError,type SqlClient} from './db';
import type {ComicCardRecord,HomeFeed,MarketTick} from '../ui/types';
const projection=`SELECT c.id,s.title,c.issue_number,p.name AS publisher,c.publication_date::text,c.variant_code,
 image.url AS cover_url,image.rights_reference AS cover_credit,
 coalesce((SELECT array_agg(k.claim ORDER BY k.claim) FROM ch_platform.comic_keys k WHERE k.comic_id=c.id AND k.verification_status='verified'),ARRAY[]::text[]) AS key_tags,
 (SELECT count(*)::int FROM ch_platform.marketplace_listings l JOIN ch_platform.listing_items i ON i.listing_id=l.id WHERE i.comic_id=c.id AND l.status='active' AND NOT l.is_custom_entry) AS listing_count,
 raw.value_cents::text AS raw_fmv,cgc.value_cents::text AS cgc_fmv,raw.observed_at::text AS as_of,raw.quote_kind
 FROM ch_platform.comics c JOIN ch_platform.series s ON s.id=c.series_id JOIN ch_platform.publishers p ON p.id=s.publisher_id
 LEFT JOIN LATERAL(SELECT url,rights_reference FROM ch_platform.comic_images WHERE comic_id=c.id AND kind='cover' AND display_allowed AND(license_expires_at IS NULL OR license_expires_at>now()) ORDER BY id LIMIT 1) image ON true
 LEFT JOIN LATERAL(SELECT q.* FROM ch_platform.fmv_records q WHERE q.comic_id=c.id AND q.grade_key='raw_nm' AND q.quote_kind IN('sold_estimate','licensed_fmv') AND q.observed_at>=now()-interval '30 days'
  AND EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs WHERE qs.record_id=q.id)
  AND NOT EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs JOIN ch_platform.data_sources ds ON ds.id=qs.source_id WHERE qs.record_id=q.id AND(NOT ds.enabled OR NOT ds.display_rights OR ds.license_reference IS NULL OR(ds.license_expires_at IS NOT NULL AND ds.license_expires_at<=now()) OR q.observed_at<now()-ds.max_age_days*interval '1 day')) ORDER BY q.observed_at DESC LIMIT 1) raw ON true
 LEFT JOIN LATERAL(SELECT q.* FROM ch_platform.fmv_records q WHERE q.comic_id=c.id AND q.grade_key='cgc_9_8_universal' AND q.quote_kind IN('sold_estimate','licensed_fmv') AND q.observed_at>=now()-interval '30 days'
  AND EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs WHERE qs.record_id=q.id)
  AND NOT EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs JOIN ch_platform.data_sources ds ON ds.id=qs.source_id WHERE qs.record_id=q.id AND(NOT ds.enabled OR NOT ds.display_rights OR ds.license_reference IS NULL OR(ds.license_expires_at IS NOT NULL AND ds.license_expires_at<=now()) OR q.observed_at<now()-ds.max_age_days*interval '1 day')) ORDER BY q.observed_at DESC LIMIT 1) cgc ON true`;
type CardRow={id:string;title:string;issue_number:string;publisher:string;publication_date:string|null;variant_code:string;cover_url:string|null;cover_credit:string|null;key_tags:string[];listing_count:number;raw_fmv:string|null;cgc_fmv:string|null;as_of:string|null;quote_kind:'sold_estimate'|'licensed_fmv'|null};
const card=(c:CardRow):ComicCardRecord=>({id:c.id,title:c.title,issueNumber:c.issue_number,publisher:c.publisher,publicationDate:c.publication_date,variant:c.variant_code,coverUrl:c.cover_url,coverCredit:c.cover_credit,keyTags:c.key_tags,listingCount:c.listing_count,rawFMVCents:c.raw_fmv,cgc98FMVCents:c.cgc_fmv,valuationAsOf:c.as_of,valuationKind:c.quote_kind||'unavailable'});
export async function searchDirectoryCards(db:SqlClient,query:string,limit=6){
 if(query.length>160||!Number.isInteger(limit)||limit<1||limit>30)throw new DomainError('invalid_search','Search limit exceeded.',400);
 const rows=(await db.query<CardRow>(projection+` WHERE c.metadata_status='canonical' AND(to_tsvector('english',s.title||' '||c.issue_title||' '||c.issue_number) @@ websearch_to_tsquery('english',$1)
  OR EXISTS(SELECT 1 FROM ch_platform.comic_characters cc JOIN ch_platform.characters ch ON ch.id=cc.character_id WHERE cc.comic_id=c.id AND to_tsvector('english',ch.name) @@ websearch_to_tsquery('english',$1))
  OR EXISTS(SELECT 1 FROM ch_platform.comic_keys k WHERE k.comic_id=c.id AND k.verification_status='verified' AND to_tsvector('english',k.claim) @@ websearch_to_tsquery('english',$1))) ORDER BY s.title,c.issue_number LIMIT $2`,[query,limit])).rows;return rows.map(card);
}
export async function buildHomeFeed(db:SqlClient):Promise<HomeFeed>{
 const items=(await db.query<CardRow>(projection+` WHERE c.metadata_status='canonical' ORDER BY(SELECT count(*) FROM ch_platform.order_items oi JOIN ch_platform.orders o ON o.id=oi.order_id WHERE oi.comic_id=c.id AND o.status='fulfilled' AND NOT o.dispute_open AND o.confirmed_delivery_at>now()-interval '7 days') DESC,c.updated_at DESC LIMIT 10`)).rows.map(card);
 const film=(await db.query<CardRow>(projection+` WHERE c.metadata_status='canonical' AND EXISTS(SELECT 1 FROM ch_platform.comic_keys k JOIN ch_platform.key_categories cat ON cat.id=k.category_id WHERE k.comic_id=c.id AND k.verification_status='verified' AND cat.slug IN('mcu-film-key','dc-film-key')) ORDER BY c.updated_at DESC LIMIT 10`)).rows.map(card);
 const ratios=(await db.query<CardRow>(projection+` JOIN ch_platform.variants v ON v.comic_id=c.id WHERE c.metadata_status='canonical' AND v.verified_at IS NOT NULL AND v.ratio_numerator IS NOT NULL ORDER BY v.ratio_denominator::numeric/v.ratio_numerator DESC,c.id LIMIT 10`)).rows.map(card);
 const count=Number((await db.query<{n:string}>("SELECT count(*)::text AS n FROM ch_platform.comics WHERE metadata_status='canonical'")).rows[0].n);
 const activity=Number((await db.query<{n:string}>("SELECT count(*)::text AS n FROM ch_platform.orders WHERE status='fulfilled' AND NOT dispute_open AND confirmed_delivery_at>now()-interval '7 days'")).rows[0].n);
 // Only comparable same-method, same-grade quotes around the 24h anchor enter
 // the ticker. No old benchmark or asking price is called a live gainer.
 const tickRows=(await db.query<{id:string;comic_id:string;title:string;grade_key:string;value_cents:string;prior_cents:string;observed_at:string;attribution:string}>(`WITH eligible AS(SELECT q.* FROM ch_platform.fmv_records q WHERE q.quote_kind IN('sold_estimate','licensed_fmv')
  AND EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs WHERE qs.record_id=q.id)
  AND NOT EXISTS(SELECT 1 FROM ch_platform.fmv_record_sources qs JOIN ch_platform.data_sources ds ON ds.id=qs.source_id WHERE qs.record_id=q.id AND(NOT ds.enabled OR NOT ds.display_rights OR ds.license_reference IS NULL OR(ds.license_expires_at IS NOT NULL AND ds.license_expires_at<=now()) OR q.observed_at<now()-ds.max_age_days*interval '1 day')))
  SELECT q.id,q.comic_id,s.title||' #'||c.issue_number AS title,q.grade_key,q.value_cents::text,prior.value_cents::text AS prior_cents,q.observed_at::text,ds.attribution
  FROM eligible q JOIN ch_platform.comics c ON c.id=q.comic_id JOIN ch_platform.series s ON s.id=c.series_id JOIN ch_platform.data_sources ds ON ds.id=q.source_id
  JOIN LATERAL(SELECT old.value_cents FROM eligible old WHERE old.comic_id=q.comic_id AND old.grade_key=q.grade_key AND old.quote_kind=q.quote_kind AND old.source_id=q.source_id AND old.methodology=q.methodology
   AND old.observed_at BETWEEN q.observed_at-interval '26 hours' AND q.observed_at-interval '22 hours' ORDER BY abs(extract(epoch FROM(q.observed_at-old.observed_at))-86400) LIMIT 1) prior ON true
  WHERE c.metadata_status='canonical' AND q.observed_at>now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM eligible newer WHERE newer.comic_id=q.comic_id AND newer.grade_key=q.grade_key AND newer.observed_at>q.observed_at)
  ORDER BY(q.value_cents-prior.value_cents)::numeric/prior.value_cents DESC LIMIT 10`)).rows;
 const market:MarketTick[]=tickRows.map(t=>({id:t.id,comicId:t.comic_id,title:t.title,gradeLabel:t.grade_key,valueCents:t.value_cents,deltaBps:Number((BigInt(t.value_cents)-BigInt(t.prior_cents))*BigInt(10000)/BigInt(t.prior_cents)),asOf:t.observed_at,sourceName:t.attribution,kind:'sold_estimate'}));
 return {items,filmKeys:film,ratioVariants:ratios,market,indexedCount:count,asOf:new Date().toISOString(),feedKind:activity>0?'trending':'editorial'};
}
