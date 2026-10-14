import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPostgres, projectRoot} from './runtime.mjs';
import path from 'node:path';

export const ids = Object.fromEntries(['alice','bob','admin','outsider'].map(name => [name, randomUUID()]));
export const asOf = new Date();
export const offsetDate = hours => new Date(asOf.getTime() + hours * 3_600_000).toISOString();
export async function database() {
  const db = await createPostgres();
  await db.exec(await readFile(path.join(projectRoot, 'architecture/postgres/schema.sql'), 'utf8'));
  for (const [name, id] of Object.entries(ids)) await db.query(
    'INSERT INTO comichuddle.users(id,external_subject,display_name) VALUES($1,$2,$3)', [id, 'synthetic-qa:' + name, name]);
  await db.query("INSERT INTO comichuddle.admin_memberships(user_id,role) VALUES($1,'ADMIN')", [ids.admin]);
  return db;
}
let sequence = 0;
export async function directory(db, options = {}) {
  const id = randomUUID(), number = String(++sequence), provisional = options.custom === true;
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO comichuddle.directory_comics
      (id,title,issue_number,publisher,series_start_year,status,canonical_edition_key,created_by_user_id)
      VALUES($1,$2,$3,'Synthetic QA Press',1988,$4,$5,$6)`,
      [id, options.title || 'Synthetic QA Comic ' + number, number, provisional ? 'PROVISIONAL' : 'CANONICAL',
        provisional ? null : 'qa-edition:' + id, options.owner || ids.alice]);
    if (provisional) await tx.query(`INSERT INTO comichuddle.review_queue(id,directory_id,submitted_by_user_id,submission_evidence)
      VALUES($1,$2,$3,$4::jsonb)`, [options.reviewId || randomUUID(), id, options.owner || ids.alice,
        JSON.stringify({type: 'SYNTHETIC_QA_EVIDENCE', privateNote: 'PRIVATE_SUBMISSION_EVIDENCE'})]);
  });
  return id;
}
export async function copy(db, directoryId, options = {}) {
  const id = randomUUID(), graded = options.format === 'GRADED';
  await db.query(`INSERT INTO comichuddle.user_collections
    (id,user_id,directory_id,physical_format,raw_condition,grade,grading_company,label_type,
     comparable_attributes_key,metadata_verification,purchase_price_cents,purchase_currency,private_notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,87654321,'USD',$11)`,
    [id, options.owner || ids.alice, directoryId, graded ? 'GRADED' : 'RAW', graded ? null : options.condition || 'NEAR_MINT',
      graded ? options.grade || '9.8' : null, graded ? options.company || 'CGC' : null,
      graded ? options.label || 'UNIVERSAL' : null, options.attributes || (graded ? 'CGC_WHITE_NO_PREMIUM' : 'STANDARD'),
      options.verification || 'VERIFIED',options.notes||'']);
  return id;
}
export async function listing(db, copies, options = {}) {
  const id = randomUUID(), seller = options.owner || ids.alice;
  const manifests = [];
  for (const copyId of copies) {
    const item = (await db.query(`SELECT c.id,c.directory_id,d.status FROM comichuddle.user_collections c
      JOIN comichuddle.directory_comics d ON d.id=c.directory_id WHERE c.id=$1`, [copyId])).rows[0];
    manifests.push({...item, itemId: randomUUID()});
  }
  const isCustom = manifests.some(item => item.status !== 'CANONICAL');
  await db.transaction(async tx => {
    await tx.query(`INSERT INTO comichuddle.marketplace_listings
      (id,seller_id,directory_comic_id,is_custom_entry,listing_type,status,asking_price_cents,currency)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, seller, options.anchor || manifests[0]?.directory_id,
      options.isCustom ?? isCustom, options.type || (copies.length === 1 ? 'SINGLE' : 'LOT'),
      options.status || (isCustom ? 'UNDER_REVIEW' : 'ACTIVE'), String(options.ask || 10000), options.currency || 'USD']);
    for (const item of manifests) await tx.query(`INSERT INTO comichuddle.listing_items
      (id,listing_id,seller_id,copy_id,directory_id) VALUES($1,$2,$3,$4,$5)`,
      [item.itemId, id, seller, item.id, item.directory_id]);
  });
  return {id, manifests, isCustom};
}
export async function source(db, options = {}) {
  const id = randomUUID(), kind = options.kind || 'LICENSED_SALES', licensed = options.licensed !== false;
  await db.query(`INSERT INTO comichuddle.valuation_sources
    (id,code,name,source_kind,verification_status,license_status,commercial_display_permitted,
     license_reference,license_valid_until,max_age_hours,minimum_sample_count,provenance_uri,
     public_attribution,public_methodology,reviewed_by_user_id,reviewed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,3,$11,$12,$13,$14,$15)`,
    [id, 'qa-source:' + id, 'Synthetic restricted source', kind,
      options.verified === false ? 'UNVERIFIED' : 'VERIFIED', licensed ? 'CURRENT' : 'ABSENT', licensed,
      licensed ? 'PRIVATE_SYNTHETIC_QA_LICENSE' : '', licensed ? offsetDate(720) : null,
      options.maxAge || 168, 'https://private.example.test/restricted-proof', 'Synthetic QA attribution',
      'Synthetic QA public methodology', options.verified === false ? null : options.reviewedBy || ids.admin,
      options.verified === false ? null : offsetDate(-2)]);
  return id;
}
export async function quote(db, directoryId, sourceId, options = {}) {
  const id = randomUUID(), graded = options.format === 'GRADED';
  await db.query(`INSERT INTO comichuddle.fmv_history
    (id,directory_id,source_id,quote_kind,physical_format,raw_condition,grade,grading_company,label_type,
     comparable_attributes_key,currency,value_cents,observed_at,sample_count,evidence_uri,evidence_sha256,
     methodology,recorded_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, directoryId, sourceId, options.kind || 'SALE_BASELINE', graded ? 'GRADED' : 'RAW',
      graded ? null : options.condition || 'NEAR_MINT', graded ? options.grade || '9.8' : null,
      graded ? options.company || 'CGC' : null, graded ? options.label || 'UNIVERSAL' : null,
      options.attributes || (graded ? 'CGC_WHITE_NO_PREMIUM' : 'STANDARD'), options.currency || 'USD',
      String(options.value ?? 20000), options.observedAt || offsetDate(-1), options.samples ?? 12,
      'https://private.example.test/PRIVATE_QUOTE_PROOF', createHash('sha256').update(id).digest('hex'),
      'PRIVATE_INTERNAL_QUOTE_METHOD', options.recordedBy || ids.admin]);
  return id;
}
export async function pricedSingle(db, options = {}) {
  const directoryId = await directory(db), sourceId = await source(db, options.source);
  const copyId = await copy(db, directoryId, options.copy);
  const row = await listing(db, [copyId], {ask: options.ask || 20000, ...options.listing});
  const quoteId = options.missing ? null : await quote(db, directoryId, sourceId, options.quote);
  return {...row, directoryId, sourceId, copyId, quoteId};
}
