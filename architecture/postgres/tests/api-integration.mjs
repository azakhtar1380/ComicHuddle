// Actual framework-neutral HTTP handlers -> request transaction -> real PG/RLS -> DTO.
// Identity and pool checkout are controlled adapters, not production OAuth/network E2E.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createReporter, loadTypeScriptModule, projectRoot, plain} from './runtime.mjs';
import {database, directory, copy, listing, source, quote, pricedSingle, ids, asOf} from './fixtures.mjs';
import {createScannerFixture} from '../../../checks/scanner-hooks.mjs';

const db = await database(), report = createReporter('PostgreSQL restricted roles and reference HTTP integration');
await db.exec(await readFile(path.join(projectRoot, 'architecture/postgres/roles.sql'), 'utf8'));
const api = loadTypeScriptModule('architecture/postgres/api.ts');
const moderation = loadTypeScriptModule('architecture/postgres/moderation.ts');
const collectionAdapter=loadTypeScriptModule('architecture/postgres/ui/collection-adapter.ts');
const session = loadTypeScriptModule('architecture/postgres/session.ts');
let authenticated = null, connections = 0, releases = 0;
const errors = [];
const databaseSessions = session.postgresSessionDatabase({async connect() {
  connections++; return {query: (sql, values) => db.query(sql, values), release() {releases++;}};
}});
const deps = {authenticate: async () => authenticated, database: databaseSessions, now: () => asOf,
  publicOrigin:'https://comichuddle.test',
  reportError: error => errors.push({code: error.code, message: error.message})};
const actor = (userId, roles = ['MEMBER']) => {authenticated = {userId, roles};};
const request = (method, body, query = '') => new Request('https://comichuddle.test/api/reference' + query,
  {method, headers: {'Content-Type': 'application/json', Origin: 'https://comichuddle.test'},
    body: method === 'GET' ? undefined : JSON.stringify(body)});
const read = async response => ({status: response.status, body: await response.json(), headers: response.headers});
const customBody = () => ({title: 'Unindexed QA ' + randomUUID(), issueNumber: '1/2', publisher: 'Synthetic Press',
  seriesStartYear: 1988, submissionEvidence: {privateEvidence: 'PRIVATE_REVIEW_EVIDENCE'}});
const sqlRole = async (role, user, callback) => db.transaction(async tx => {
  await tx.exec('SET LOCAL ROLE ' + role);
  await tx.query("SELECT set_config('app.user_id',$1,true)", [user || '']);
  return callback(tx);
});

await report.test('Capability roles are NOLOGIN/NOSUPERUSER/NOBYPASSRLS with no public moderation execute', async () => {
  const roles = (await db.query("SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname LIKE 'comichuddle_%'")).rows;
  assert.ok(roles.length >= 7); assert.ok(roles.every(value => !value.rolcanlogin && !value.rolsuper && !value.rolbypassrls));
  assert.equal((await db.query("SELECT has_function_privilege('public','comichuddle.merge_custom_edition(uuid,uuid,bigint,bigint,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed, false);
});
await report.test('Collector RLS reads only own copies and rejects a spoofed owner insert', async () => {
  const d = await directory(db), aliceCopy = await copy(db, d), bobCopy = await copy(db, d, {owner: ids.bob});
  const found = await sqlRole('comichuddle_collector', ids.alice, tx => tx.query('SELECT id FROM comichuddle.user_collections ORDER BY id'));
  assert.ok(found.rows.some(value => value.id === aliceCopy)); assert.ok(!found.rows.some(value => value.id === bobCopy));
  await assert.rejects(sqlRole('comichuddle_collector', ids.alice, tx => tx.query(`INSERT INTO comichuddle.user_collections
    (user_id,directory_id,physical_format,raw_condition) VALUES($1,$2,'RAW','NEAR_MINT')`, [ids.bob, d])), error => error.code === '42501');
  const absent = await sqlRole('comichuddle_collector', '', tx => tx.query('SELECT id FROM comichuddle.user_collections'));
  assert.deepEqual(absent.rows, []);
});
await report.test('Collector role cannot edit canonical status, read another submission or grant itself admin', async () => {
  const custom = await directory(db, {custom: true, owner: ids.bob});
  const found = await sqlRole('comichuddle_collector', ids.alice, tx => tx.query('SELECT id FROM comichuddle.review_queue WHERE directory_id=$1', [custom]));
  assert.deepEqual(found.rows, []);
  for (const sql of ["UPDATE comichuddle.directory_comics SET status='CANONICAL' WHERE id='" + custom + "'",
    "INSERT INTO comichuddle.admin_memberships(user_id,role) VALUES('" + ids.alice + "','ADMIN')",
    "SELECT * FROM comichuddle.fmv_history", "SELECT * FROM comichuddle.valuation_sources"]) {
    await assert.rejects(sqlRole('comichuddle_collector', ids.alice, tx => tx.query(sql)), error => error.code === '42501');
  }
});
await report.test('Collector cannot promote its own declared copy metadata to trusted verification', async () => {
  const d=await directory(db), owned=await copy(db,d,{verification:'DECLARED'});
  await assert.rejects(sqlRole('comichuddle_collector',ids.alice,tx=>tx.query(
    "UPDATE comichuddle.user_collections SET metadata_verification='VERIFIED' WHERE id=$1",[owned])),
    error=>['42501','23514'].includes(error.code));
  await assert.rejects(sqlRole('comichuddle_collector',ids.alice,tx=>tx.query(`INSERT INTO comichuddle.user_collections
    (user_id,directory_id,physical_format,raw_condition,metadata_verification)
    VALUES($1,$2,'RAW','NEAR_MINT','VERIFIED')`,[ids.alice,d])),error=>['42501','23514'].includes(error.code));
  assert.equal((await db.query('SELECT metadata_verification FROM comichuddle.user_collections WHERE id=$1',[owned])).rows[0].metadata_verification,'DECLARED');
});
await report.test('Private copy notes accept owner writes, hide from peers/public facts and enforce the500character cap',async()=>{
  const row=await pricedSingle(db),note='PRIVATE_COLLECTION_NOTE';
  await sqlRole('comichuddle_collector',ids.alice,tx=>tx.query('UPDATE comichuddle.user_collections SET private_notes=$1 WHERE id=$2',[note,row.copyId]));
  const own=await sqlRole('comichuddle_collector',ids.alice,tx=>tx.query('SELECT private_notes FROM comichuddle.user_collections WHERE id=$1',[row.copyId]));
  assert.equal(own.rows[0].private_notes,note);
  const peer=await sqlRole('comichuddle_collector',ids.bob,tx=>tx.query('SELECT private_notes FROM comichuddle.user_collections WHERE id=$1',[row.copyId]));assert.deepEqual(peer.rows,[]);
  await assert.rejects(sqlRole('comichuddle_collector',ids.alice,tx=>tx.query('UPDATE comichuddle.user_collections SET private_notes=$1 WHERE id=$2',['x'.repeat(501),row.copyId])),error=>error.code==='23514');
  actor(ids.bob);const response=await read(await api.handleDealAnalysisRequest(request('GET'),deps,row.id));assert.equal(response.status,200);assert.ok(!JSON.stringify(response.body).includes(note));
  const facts=await sqlRole('comichuddle_valuator',ids.bob,tx=>tx.query('SELECT * FROM comichuddle.marketplace_item_facts WHERE listing_id=$1',[row.id]));assert.equal(facts.rows[0].private_notes,undefined);
});
await report.test('Restricted ingestion role can insert an authorized baseline and retain source-owned provenance', async () => {
  const d=await directory(db), s=await source(db);
  const id=await sqlRole('comichuddle_ingest',ids.admin,tx=>quote(tx,d,s));
  const stored=(await db.query('SELECT license_reference_snapshot,verification_snapshot FROM comichuddle.fmv_history WHERE id=$1',[id])).rows[0];
  assert.equal(stored.verification_snapshot,'VERIFIED'); assert.equal(stored.license_reference_snapshot,'PRIVATE_SYNTHETIC_QA_LICENSE');
});
await report.test('Ingestion cannot approve source policy and cannot spoof the quote recorder', async () => {
  const d=await directory(db), s=await source(db);
  await assert.rejects(sqlRole('comichuddle_ingest',ids.admin,tx=>tx.query(
    "UPDATE comichuddle.valuation_sources SET verification_status='UNVERIFIED' WHERE id=$1",[s])),error=>error.code==='42501');
  await assert.rejects(sqlRole('comichuddle_ingest',ids.alice,tx=>quote(tx,d,s,{recordedBy:ids.admin})),error=>error.code==='42501');
  const id=await sqlRole('comichuddle_ingest',ids.alice,tx=>quote(tx,d,s,{recordedBy:ids.alice}));
  assert.equal((await db.query('SELECT recorded_by_user_id FROM comichuddle.fmv_history WHERE id=$1',[id])).rows[0].recorded_by_user_id,ids.alice);
});
await report.test('An untrusted member in moderator capability cannot approve a value source', async () => {
  const s=await source(db);
  const result=await sqlRole('comichuddle_moderator',ids.bob,tx=>tx.query(
    "UPDATE comichuddle.valuation_sources SET commercial_display_permitted=false WHERE id=$1 RETURNING id",[s]));
  assert.deepEqual(result.rows,[]);
  await assert.rejects(sqlRole('comichuddle_moderator',ids.bob,tx=>source(tx)),error=>error.code==='42501');
  assert.equal((await db.query('SELECT commercial_display_permitted FROM comichuddle.valuation_sources WHERE id=$1',[s])).rows[0].commercial_display_permitted,true);
});
await report.test('An active admin may approve a source only with its authenticated reviewer identity', async () => {
  const s=await sqlRole('comichuddle_moderator',ids.admin,tx=>source(tx));
  assert.equal((await db.query('SELECT reviewed_by_user_id FROM comichuddle.valuation_sources WHERE id=$1',[s])).rows[0].reviewed_by_user_id,ids.admin);
  await assert.rejects(sqlRole('comichuddle_moderator',ids.admin,tx=>source(tx,{reviewedBy:ids.bob})),error=>error.code==='42501');
});
await report.test('Restricted commerce role can record an exact active bid for the authenticated buyer', async () => {
  const row=await pricedSingle(db), id=randomUUID();
  await sqlRole('comichuddle_commerce',ids.bob,tx=>tx.query(`INSERT INTO comichuddle.marketplace_bids
    (id,listing_id,bidder_id,directory_id_snapshot,amount_cents,currency,valuation_snapshot,status)
    VALUES($1,$2,$3,$4,15000,'USD',$5::jsonb,'OPEN')`,[id,row.id,ids.bob,row.directoryId,JSON.stringify({fixture:'NO_PAYMENT_EXECUTED'})]));
  const stored=(await db.query('SELECT bidder_id,status FROM comichuddle.marketplace_bids WHERE id=$1',[id])).rows[0];
  assert.equal(stored.bidder_id,ids.bob); assert.equal(stored.status,'OPEN');
});
await report.test('Guest and wrong-method HTTP calls return401/405 before database checkout', async () => {
  authenticated = null; const before = connections;
  assert.equal((await read(await api.handleDealAnalysisRequest(request('GET'), deps, randomUUID()))).status, 401);
  assert.equal((await read(await api.handleCustomDirectoryRequest(request('POST', customBody()), deps))).status, 401);
  assert.equal((await read(await api.handleMergeReviewRequest(request('POST', {}), deps, randomUUID()))).status, 401);
  assert.equal((await read(await api.handleApproveReviewRequest(request('POST', {}), deps, randomUUID()))).status, 401);
  assert.equal(connections, before);
  const wrong = await api.handleDealAnalysisRequest(request('POST', {}), deps, randomUUID()); assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'GET');
  assert.equal((await api.handleCustomDirectoryRequest(request('GET'), deps)).status, 405);
});
await report.test('Custom HTTP create returns real provisional UUID and matching pending review; actor JSON cannot override auth', async () => {
  actor(ids.alice); const result = await read(await api.handleCustomDirectoryRequest(request('POST',
    {...customBody(), actorUserId: ids.admin, createdByUserId: ids.bob, isCustomEntry:false, status:'CANONICAL', fmvCents:'99999999'}), deps));
  assert.equal(result.status, 201, JSON.stringify(result.body)); assert.equal(result.body.status, 'PROVISIONAL');
  assert.equal(result.body.purchaseEligible, false); assert.equal(result.body.quoteState, 'CUSTOM_PENDING_REVIEW');
  const stored = (await db.query('SELECT d.created_by_user_id,d.status,r.submitted_by_user_id,r.status AS review_status FROM comichuddle.directory_comics d JOIN comichuddle.review_queue r ON r.directory_id=d.id WHERE d.id=$1', [result.body.directoryId])).rows[0];
  assert.equal(stored.created_by_user_id, ids.alice); assert.equal(stored.submitted_by_user_id, ids.alice);
  assert.equal(stored.status, 'PROVISIONAL'); assert.equal(stored.review_status, 'PENDING');
});
await report.test('Active buyer HTTP analysis executes actual valuation role and returns a sanitized no-store DTO', async () => {
  const row = await pricedSingle(db, {ask: 15000}); actor(ids.bob);
  const result = await read(await api.handleDealAnalysisRequest(request('GET'), deps, row.id));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.position, 'BELOW_MARKET');
  assert.equal(result.body.variancePercent, -25); assert.equal(result.body.baselineCents, '20000');
  assert.match(result.headers.get('cache-control'), /private, no-store/);
  for (const secret of ['PRIVATE_QUOTE_PROOF','PRIVATE_SYNTHETIC_QA_LICENSE','PRIVATE_INTERNAL_QUOTE_METHOD','87654321']) assert.ok(!JSON.stringify(result.body).includes(secret));
});
await report.test('Actual HTTP-to-PostgreSQL DTO drives two exact card modes and the collection callback',async()=>{
  const d=await directory(db),s=await source(db),raw=await copy(db,d),graded=await copy(db,d,{format:'GRADED'});
  await quote(db,d,s,{value:12000});await quote(db,d,s,{format:'GRADED',value:40000});
  const row=await listing(db,[raw,graded],{ask:52000});actor(ids.bob);
  const result=await read(await api.handleDealAnalysisRequest(request('GET'),deps,row.id));assert.equal(result.status,200);
  // Explicitly controlled DTO-to-card adapter. Production directory adapter is not deployed.
  const cardQuote=item=>({directoryComicId:item.directoryComicId,amountCents:item.fmvCents,currency:result.body.currency,
    format:item.format,rawCondition:item.rawCondition,gradingCompany:item.gradingCompany,grade:item.grade,
    labelType:item.labelType,sourceName:item.evidence.source,
    observedAt:item.evidence.observedAt,expiresAt:item.evidence.expiresAt,displayPermitted:item.quoteState==='PRICED',
    comparableAttributesKey:item.comparableAttributesKey});
  const rawItem=result.body.items.find(item=>item.format==='RAW'),gradedItem=result.body.items.find(item=>item.format==='GRADED');
  const callbacks=[],f=createScannerFixture({componentFile:'architecture/postgres/ui/ComicProductCard.tsx',props:{
    comic:{id:d,title:rawItem.title,issueNumber:rawItem.issueNumber,publisher:'Synthetic QA Press',year:1988,variantTags:['Standard'],
      coverUrl:null,coverDisplayAllowed:false,catalogStatus:'CANONICAL',activeListingCount:1,valuationStatus:'AVAILABLE',
      rawQuote:cardQuote(rawItem),cgc98Quote:cardQuote(gradedItem)},onAddToCollection:async(...args)=>callbacks.push(args)}});
  await f.flush();assert.match(f.snapshot(),/\$120\.00/);await f.click('CGC 9.8 FMV');assert.match(f.snapshot(),/\$400\.00/);
  await f.click('Add to Collection');const form=f.find(node=>node.type==='form');
  await form.props.onSubmit({preventDefault(){},currentTarget:{rawCondition:'FINE',purchasePrice:'12.34',acquiredOn:'',notes:'PRIVATE_CALLBACK_NOTES'}});
  await f.flush();assert.equal(callbacks.length,1);assert.equal(callbacks[0][0],d);assert.equal(callbacks[0][1].purchasePriceCents,'1234');
  assert.ok(!f.snapshot().includes('PRIVATE_SYNTHETIC_QA_LICENSE'));f.unmount();
});
await report.test('Other collector’s draft is not visible and under-review preview remains explicitly unpaid', async () => {
  const d = await directory(db), draft = await listing(db, [await copy(db, d)], {status:'DRAFT'});
  actor(ids.bob); assert.equal((await api.handleDealAnalysisRequest(request('GET'), deps, draft.id)).status, 404);
  const custom = await directory(db, {custom:true}), pending = await listing(db, [await copy(db, custom)]);
  assert.equal((await api.handleDealAnalysisRequest(request('GET'), deps, pending.id)).status, 404);
  const result = await read(await api.handleDealAnalysisRequest(request('GET', null, '?preview=under-review'), deps, pending.id));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.purchaseEligible, false);
  assert.equal(result.body.isCustomEntry, true); assert.equal(result.body.position, 'UNKNOWN');
});
await report.test('Admin HTTP authorization and DB membership both reject forged moderation authority', async () => {
  const reviewId = randomUUID(), custom = await directory(db, {custom:true, reviewId}), target = await directory(db);
  const body = {targetDirectoryId:target,expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:randomUUID(),actorUserId:ids.admin};
  actor(ids.bob); const before = connections;
  assert.equal((await api.handleMergeReviewRequest(request('POST', body), deps, reviewId)).status, 403); assert.equal(connections, before);
  actor(ids.bob, ['ADMIN']); const result = await read(await api.handleMergeReviewRequest(request('POST', body), deps, reviewId));
  assert.equal(result.status, 403); assert.equal(result.body.code, 'NOT_AUTHORIZED');
  assert.equal((await db.query('SELECT status FROM comichuddle.directory_comics WHERE id=$1', [custom])).rows[0].status, 'PROVISIONAL');
});
await report.test('Restricted moderator HTTP merge commits one alias/audit and exact retry returns same outcome', async () => {
  const reviewId = randomUUID(), custom = await directory(db, {custom:true, reviewId}), target = await directory(db);
  const row = await listing(db, [await copy(db, custom)]), body = {targetDirectoryId:target,
    expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:randomUUID(),actorUserId:ids.bob};
  actor(ids.admin, ['ADMIN']); const result = await read(await api.handleMergeReviewRequest(request('POST', body), deps, reviewId));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.outcome, 'MERGED');
  assert.equal(result.body.movedCopies, 1); assert.equal(result.body.movedListingItems, 1);
  const repeated = await read(await api.handleMergeReviewRequest(request('POST', body), deps, reviewId)); assert.deepEqual(repeated.body, result.body);
  assert.equal((await db.query('SELECT actor_user_id FROM comichuddle.moderation_audit WHERE request_id=$1', [body.requestId])).rows[0].actor_user_id, ids.admin);
  assert.equal((await db.query('SELECT is_custom_entry,status FROM comichuddle.marketplace_listings WHERE id=$1', [row.id])).rows[0].is_custom_entry, false);
});
await report.test('A former custom UUID resolves to its canonical alias for buyers while another pending UUID stays private',async()=>{
  const reviewId=randomUUID(),custom=await directory(db,{custom:true,reviewId}),target=await directory(db);
  actor(ids.admin,['ADMIN']);const merged=await api.handleMergeReviewRequest(request('POST',{targetDirectoryId:target,
    expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:randomUUID()}),deps,reviewId);assert.equal(merged.status,200);
  assert.equal(await sqlRole('comichuddle_reader',ids.bob,tx=>moderation.resolveDirectoryId(tx,custom)),target);
  const pending=await directory(db,{custom:true});
  assert.equal(await sqlRole('comichuddle_reader',ids.bob,tx=>moderation.resolveDirectoryId(tx,pending)),null);
  assert.equal(await sqlRole('comichuddle_reader',ids.alice,tx=>moderation.resolveDirectoryId(tx,pending)),pending);
});
const rawEntry={format:'RAW',rawCondition:null,gradingCompany:null,grade:null,labelType:null,certificationNumber:null,
  purchasePriceCents:'0',acquiredOn:'2026-10-12',notes:'PRIVATE_ADAPTER_OWNER_NOTES'};
const saveCopy=(user,directoryId,entry,requestId)=>databaseSessions.withSession({userId:user,role:'comichuddle_collector'},
  tx=>collectionAdapter.saveOwnedCopy(tx,user,directoryId,entry,requestId));
await report.test('Actual collection SQL adapter writes one owned copy and replays only the same identity/payload',async()=>{
  const d=await directory(db),requestId=randomUUID(),first=await saveCopy(ids.bob,d,rawEntry,requestId);
  assert.equal(first.copyId,requestId);assert.equal(first.replayed,false);
  const repeated=await saveCopy(ids.bob,d,rawEntry,requestId);assert.equal(repeated.replayed,true);
  const stored=(await db.query('SELECT * FROM comichuddle.user_collections WHERE id=$1',[requestId])).rows[0];
  assert.equal(stored.user_id,ids.bob);assert.equal(stored.directory_id,d);assert.equal(stored.raw_condition,'UNKNOWN');
  assert.equal(String(stored.purchase_price_cents),'0');assert.equal(stored.private_notes,rawEntry.notes);
  assert.equal(stored.metadata_verification,'DECLARED');assert.equal(stored.comparable_attributes_key,'UNKNOWN');
  await assert.rejects(saveCopy(ids.bob,d,{...rawEntry,notes:'changed'},requestId),/conflicts/);
  await assert.rejects(saveCopy(ids.alice,d,rawEntry,requestId),/conflicts/);
  const other=await directory(db);await assert.rejects(saveCopy(ids.bob,other,rawEntry,requestId),/conflicts/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.user_collections WHERE id=$1',[requestId])).rows[0].n,1);
});
await report.test('Collection adapter maps slab labels explicitly without certifying metadata or inferring premium FMV',async()=>{
  const d=await directory(db),entry={...rawEntry,format:'GRADED',rawCondition:null,gradingCompany:'CGC',grade:'9.8',
    labelType:'Signature Series',certificationNumber:'9876543210123456',purchasePriceCents:'1234'},requestId=randomUUID();
  await saveCopy(ids.bob,d,entry,requestId);const stored=(await db.query('SELECT * FROM comichuddle.user_collections WHERE id=$1',[requestId])).rows[0];
  assert.equal(stored.label_type,'SIGNATURE');assert.equal(stored.grade,'9.8');assert.equal(stored.certification_number,entry.certificationNumber);
  assert.equal(stored.comparable_attributes_key,'UNKNOWN');assert.equal(stored.metadata_verification,'DECLARED');
  assert.equal((await saveCopy(ids.bob,d,entry,requestId)).replayed,true);
});
await report.test('Collection adapter resolves a former custom UUID to the canonical edition and hides unowned pending identity',async()=>{
  const reviewId=randomUUID(),custom=await directory(db,{custom:true,reviewId}),target=await directory(db);
  actor(ids.admin,['ADMIN']);assert.equal((await api.handleMergeReviewRequest(request('POST',{targetDirectoryId:target,
    expectedSourceVersion:'1',expectedTargetVersion:'1',requestId:randomUUID()}),deps,reviewId)).status,200);
  const saved=await saveCopy(ids.bob,custom,rawEntry,randomUUID());assert.equal(saved.directoryComicId,target);
  const pending=await directory(db,{custom:true});await assert.rejects(saveCopy(ids.bob,pending,rawEntry,randomUUID()),/unavailable/);
});
await report.test('Admin identity approval creates no FMV and cannot consume a supplied price', async () => {
  const reviewId = randomUUID(), custom = await directory(db, {custom:true, reviewId});
  actor(ids.admin, ['MODERATOR']); const before = (await db.query('SELECT count(*)::int AS n FROM comichuddle.fmv_history')).rows[0].n;
  const result = await read(await api.handleApproveReviewRequest(request('POST', {canonicalEditionKey:'qa-approved:' + custom,
    seriesStartYear:1988,expectedVersion:'1',requestId:randomUUID(),actorUserId:ids.bob,price:500000,fmvCents:'500000'}), deps, reviewId));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.outcome, 'APPROVED');
  assert.equal((await db.query('SELECT status FROM comichuddle.directory_comics WHERE id=$1', [custom])).rows[0].status, 'CANONICAL');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM comichuddle.fmv_history')).rows[0].n, before);
});
await report.test('Malformed IDs, malformed JSON and missing required fields fail with generic400 responses', async () => {
  actor(ids.alice); assert.equal((await api.handleDealAnalysisRequest(request('GET'), deps, "x' OR1=1" )).status, 400);
  assert.equal((await api.handleCustomDirectoryRequest(request('POST', {title:''}), deps)).status, 400);
  const malformed = new Request('https://comichuddle.test/api/reference', {method:'POST',headers:{'content-type':'application/json',Origin:'https://comichuddle.test'},body:'{broken'});
  const result = await read(await api.handleCustomDirectoryRequest(malformed, deps)); assert.equal(result.status, 400); assert.equal(result.body.code, 'INVALID_JSON_BODY');
});
await report.test('Mutation origin/type gates reject missing/foreign origin and nonJSON before any database checkout',async()=>{
  actor(ids.alice);const before=connections;
  for(const [headers,status,code] of [[{'content-type':'application/json'},403,'ORIGIN_REJECTED'],
    [{'content-type':'application/json',Origin:'https://foreign.example'},403,'ORIGIN_REJECTED'],
    [{'content-type':'text/plain',Origin:'https://comichuddle.test'},415,'JSON_CONTENT_TYPE_REQUIRED']]){
    const r=new Request('https://comichuddle.test/api/reference',{method:'POST',headers,body:JSON.stringify(customBody())});
    const result=await read(await api.handleCustomDirectoryRequest(r,deps));assert.equal(result.status,status);assert.equal(result.body.code,code);
  }
  assert.equal(connections,before);
});
await report.test('Actual mutation byte limit rejects dishonest length, multibyte and multi-chunk streams without SQL writes',async()=>{
  actor(ids.alice);const before=connections,body=JSON.stringify({...customBody(),submissionEvidence:{padding:'x'.repeat(17000)}});
  for(const declared of [undefined,'1','20000']){
    const headers={'content-type':'application/json',Origin:'https://comichuddle.test'};if(declared)headers['content-length']=declared;
    const result=await read(await api.handleCustomDirectoryRequest(new Request('https://comichuddle.test/api/reference',{method:'POST',headers,body}),deps));
    assert.equal(result.status,413);assert.equal(result.body.code,'REQUEST_BODY_TOO_LARGE');
  }
  const encoder=new TextEncoder(),chunks=[encoder.encode('a'.repeat(20)),encoder.encode('🚀'.repeat(20))];
  const stream=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}});
  const streamed=new Request('https://comichuddle.test/api/reference',{method:'POST',headers:{'content-type':'application/json',Origin:'https://comichuddle.test'},body:stream,duplex:'half'});
  const result=await read(await api.handleCustomDirectoryRequest(streamed,{...deps,maxMutationBodyBytes:64}));
  assert.equal(result.status,413);assert.equal(result.body.code,'REQUEST_BODY_TOO_LARGE');assert.equal(connections,before);
});
await report.test('Stale moderation requests return409 and session role/actor context reset after failures', async () => {
  const reviewId = randomUUID(), custom = await directory(db, {custom:true, reviewId}), target = await directory(db);
  actor(ids.admin, ['ADMIN']); const result = await read(await api.handleMergeReviewRequest(request('POST', {targetDirectoryId:target,
    expectedSourceVersion:'999',expectedTargetVersion:'1',requestId:randomUUID()}), deps, reviewId));
  assert.equal(result.status, 409); assert.equal(result.body.code, 'RELOAD_CONFLICT');
  const reset = (await db.query("SELECT current_user AS actor,current_setting('app.user_id',true) AS identity")).rows[0];
  assert.equal(reset.actor, db.engineKind === 'native-postgresql' ? 'qa_owner' : 'postgres'); assert.ok(!reset.identity);
  assert.equal(connections, releases); assert.equal((await db.query('SELECT status FROM comichuddle.directory_comics WHERE id=$1', [custom])).rows[0].status, 'PROVISIONAL');
});
await report.test('Unexpected database failure never returns raw SQL, proof URLs or license text', async () => {
  actor(ids.alice); const privateError = Error('PRIVATE INTERNAL SQL PRIVATE_LICENSE_SECRET');
  const result = await read(await api.handleDealAnalysisRequest(request('GET'), {...deps,
    database:{withSession: async () => {throw privateError;}}}, randomUUID()));
  assert.equal(result.status, 503); assert.equal(result.body.code, 'ANALYSIS_TEMPORARILY_UNAVAILABLE');
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE')); assert.ok(errors.some(error => error.message.includes('PRIVATE_LICENSE_SECRET')));
});

console.log('REFERENCE_SERVER_ERRORS ' + JSON.stringify(errors));
report.finish({engineKind:db.engineKind, genuineProviderCalls:0, paymentExecutions:0,
  integration:'Actual reference Request/Response handlers + session roles/RLS + PostgreSQL SQL; synthetic authenticated actor; no HTTP server',
  productionOAuth:'NOT EXECUTED', hostedEndpoints:'NOT DEPLOYED BY THIS SUITE'});
await db.close();
