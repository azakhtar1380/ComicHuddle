import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMarketplaceDeal, DealAnalysisError, publicDealAnalysis } from "./analyzer.js";
import { handleCustomDirectoryRequest, handleDealAnalysisRequest, handleMergeReviewRequest } from "./api.js";
import { postgresSessionDatabase } from "./session.js";
import type { ApiDependencies } from "./api.js";
import type { DatabaseSessionContext } from "./session.js";
import type { Queryable } from "./types.js";

const listingId="10000000-0000-4000-8000-000000000001";
const actorId="20000000-0000-4000-8000-000000000001";
const directoryId="30000000-0000-4000-8000-000000000001";
const asOf=new Date("2026-10-13T12:00:00Z");
type Row=Record<string,unknown>;
function row(overrides: Row={}): Row {
  return { listing_id:listingId,seller_id:actorId,directory_comic_id:directoryId,is_custom_entry:false,
    listing_type:"SINGLE",listing_status:"ACTIVE",asking_cents:"10000",currency:"USD",
    listing_item_id:"40000000-0000-4000-8000-000000000001",copy_id:"50000000-0000-4000-8000-000000000001",
    directory_id:directoryId,title:"Example Comics",issue_number:"1",variant_name:"Standard",directory_status:"CANONICAL",
    physical_format:"RAW",raw_condition:"NEAR_MINT",grade_text:null,grading_company:null,label_type:null,
    comparable_attributes_key:"STANDARD",metadata_verification:"DECLARED",
    quote_id:"60000000-0000-4000-8000-000000000001",source_id:"70000000-0000-4000-8000-000000000001",
    source_name:"Private supplier name",quote_kind:"SALE_BASELINE",quote_cents:"10000",
    observed_at:"2026-10-12T12:00:00Z",expires_at:"2026-10-19T12:00:00Z",sample_count:8,
    evidence_uri:"private://contributor-proof",evidence_sha256:"a".repeat(64),methodology:"Private ingestion details",
    license_reference_snapshot:"Private supplier contract",public_attribution:"Approved source attribution",
    public_methodology:"Median comparable completed sales",display_rights_current:true,evaluated_state:"PRICED",
    editorial_quote:null,...overrides };
}
function db(rows: Row[], capture?: (sql:string,values?:unknown[])=>void): Queryable {
  return { async query<T extends Row>(sql:string,values?:unknown[]) {
    capture?.(sql,values); return { rows:rows as T[] };
  } };
}
async function analyze(rows: Row[]) { return analyzeMarketplaceDeal(db(rows),listingId,{asOf}); }

test("85%/115% price boundaries are explicit and use an exact current baseline",async()=>{
  for(const [asking,position,variance] of [["8500","BELOW_MARKET",-15],["8510","FAIR",-14.9],["11499","FAIR",14.99],["11500","OVERPRICED",15]] as const) {
    const result=await analyze([row({asking_cents:asking})]);
    assert.equal(result.position,position); assert.equal(result.variancePercent,variance);
    assert.equal(result.baselineCents,"10000"); assert.equal(result.coveragePercent,100);
    assert.ok(result.reasons.includes("EXACT_CURRENT_BASELINE"));
  }
});
test("very low asks flag price/data caution without asserting seller fraud or safety",async()=>{
  const result=await analyze([row({asking_cents:"4999"})]);
  assert.equal(result.position,"BELOW_MARKET"); assert.equal(result.riskScore,90);
  assert.equal(result.riskKind,"PRICE_DATA_CAUTION"); assert.ok(result.reasons.includes("VERY_LOW_ASKING_PRICE"));
  assert.match(result.riskExplanation,/not a fraud probability/); assert.notEqual(result.badge.label,"Secure Deal");
  assert.equal((await analyze([row({asking_cents:"5000"})])).riskScore,20);
});
test("lots sum every exact copy instead of valuing their header anchor once",async()=>{
  const common={listing_type:"LOT",asking_cents:"24000"};
  const result=await analyze([row(common),row({...common,listing_item_id:"40000000-0000-4000-8000-000000000002",
    copy_id:"50000000-0000-4000-8000-000000000002",directory_id:"30000000-0000-4000-8000-000000000002",
    quote_id:"60000000-0000-4000-8000-000000000002",quote_cents:"20000",title:"Other edition"})]);
  assert.equal(result.baselineCents,"30000"); assert.equal(result.variancePercent,-20);
  assert.equal(result.totalCopies,2); assert.equal(result.pricedCopies,2);
});
test("partial lot coverage stays Unknown and identifies the priced subtotal",async()=>{
  const common={listing_type:"LOT",asking_cents:"10000"};
  const result=await analyze([row(common),row({...common,listing_item_id:"40000000-0000-4000-8000-000000000002",
    copy_id:"50000000-0000-4000-8000-000000000002",evaluated_state:null,quote_id:null,quote_cents:null,display_rights_current:false})]);
  assert.equal(result.position,"UNKNOWN"); assert.equal(result.baselineCents,null); assert.equal(result.variancePercent,null);
  assert.equal(result.pricedSubtotalCents,"10000"); assert.equal(result.coveragePercent,50); assert.equal(result.riskScore,60);
  assert.ok(result.reasons.includes("PARTIAL_COVERAGE")); assert.equal(result.items[1].quoteState,"MISSING");
});
test("customs, stale/blocked quotes and unknown premium attributes never become a baseline",async()=>{
  const cases: Array<[Row,string]>=[
    [{directory_status:"PROVISIONAL",listing_status:"UNDER_REVIEW"},"CUSTOM_PENDING_REVIEW"],
    [{evaluated_state:"STALE"},"STALE"], [{evaluated_state:"LICENSE_UNAVAILABLE",display_rights_current:false},"LICENSE_UNAVAILABLE"],
    [{evaluated_state:"UNVERIFIED_SOURCE"},"UNVERIFIED_SOURCE"], [{evaluated_state:"INSUFFICIENT_SAMPLE"},"INSUFFICIENT_SAMPLE"],
    [{raw_condition:"UNKNOWN"},"CONDITION_UNKNOWN"],[{comparable_attributes_key:"UNKNOWN"},"CONDITION_UNKNOWN"],
    [{quote_cents:"0"},"INVALID_QUOTE"],[{quote_cents:"NaN"},"INVALID_QUOTE"],[{quote_cents:"Infinity"},"INVALID_QUOTE"],
  ];
  for(const [changes,state] of cases) {
    const result=await analyze([row(changes)]);
    assert.equal(result.items[0].quoteState,state); assert.equal(result.baselineCents,null);
    assert.equal(result.position,"UNKNOWN"); assert.equal(result.riskScore,60);
  }
  assert.equal((await analyze([row({directory_status:"PROVISIONAL",listing_status:"UNDER_REVIEW"})])).purchaseEligible,false);
});
test("editorial evidence stays explicitly separate from sale-based FMV",async()=>{
  const editorial={...row(),id:"80000000-0000-4000-8000-000000000001",quote_kind:"EDITORIAL_ESTIMATE",value_cents:"12345"};
  const result=await analyze([row({quote_kind:"EDITORIAL_ESTIMATE",evaluated_state:"EDITORIAL_ONLY",editorial_quote:editorial})]);
  assert.equal(result.baselineCents,null); assert.equal(result.position,"UNKNOWN");
  assert.equal(result.items[0].editorialEstimateCents,"12345"); assert.equal(result.items[0].editorialEvidence?.kind,"EDITORIAL_ESTIMATE");
});
test("bigint cents retain exact sums above the JavaScript safe-integer range",async()=>{
  const result=await analyze([row({asking_cents:"9223372036854775807",quote_cents:"1"})]);
  assert.equal(result.askingPriceCents,"9223372036854775807"); assert.equal(result.position,"OVERPRICED");
  assert.ok(Number.isFinite(result.variancePercent));
  const huge={listing_type:"LOT",asking_cents:"1",quote_cents:"9223372036854775807"};
  const lot=await analyze([row(huge),row({...huge,listing_item_id:"40000000-0000-4000-8000-000000000002",copy_id:"50000000-0000-4000-8000-000000000002"})]);
  assert.equal(lot.baselineCents,"18446744073709551614"); assert.equal(lot.riskScore,90);
});
test("buyer projection strips private supplier license/proof and private methodology",async()=>{
  const internal=await analyze([row()]); const projected=publicDealAnalysis(internal); const json=JSON.stringify(projected);
  for(const secret of ["evidenceUri","evidenceSha256","licenseReference","private://","Private supplier","Private ingestion"])
    assert.ok(!json.includes(secret),`public response leaked ${secret}`);
  assert.equal(projected.evidence[0].source,"Approved source attribution");
  assert.equal(projected.evidence[0].methodology,"Median comparable completed sales");
});
test("query arguments are parameterized and absence is not a zero-value comic",async()=>{
  let values:unknown[]|undefined;
  await analyzeMarketplaceDeal(db([row()],(_sql,v)=>{values=v;}),listingId,{asOf});
  assert.deepEqual(values,[listingId,asOf.toISOString()]);
  await assert.rejects(()=>analyzeMarketplaceDeal(db([]),listingId,{asOf}),DealAnalysisError);
  await assert.rejects(()=>analyzeMarketplaceDeal(db([row()]),"bad' OR true --"),TypeError);
});

function dependencies(query: Queryable,actor:ApiDependencies["authenticate"] = async()=>({userId:actorId,roles:["MEMBER"]})): ApiDependencies {
  return { authenticate:actor,now:()=>asOf,publicOrigin:"https://example.test",database:{async withSession(_context,work){return work(query);}} };
}
test("HTTP buyer response uses the public projection and auth failures execute no SQL",async()=>{
  let queries=0;const query=db([row()],()=>{queries++;});
  const response=await handleDealAnalysisRequest(new Request("https://example.test/api/marketplace/x/deal-analysis"),dependencies(query),listingId);
  assert.equal(response.status,200); assert.ok(!(await response.text()).includes("private://"));
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  const unauth=await handleDealAnalysisRequest(new Request("https://example.test/"),dependencies(query,async()=>null),listingId);
  assert.equal(unauth.status,401); assert.equal(queries,1);
  assert.equal((await handleDealAnalysisRequest(new Request("https://example.test/"),dependencies(db([])),listingId)).status,404);
});
test("custom creation and admin merge take the actor from server auth, never request JSON",async()=>{
  let context:DatabaseSessionContext|undefined;let values:unknown[]|undefined;
  const customDb=db([{directory_id:directoryId,review_id:"90000000-0000-4000-8000-000000000001",version:"1"}],(_sql,v)=>{values=v;});
  const deps=dependencies(customDb); deps.database={async withSession(c,work){context=c;return work(customDb);}};
  const custom=await handleCustomDirectoryRequest(new Request("https://example.test/api/directory/custom",{method:"POST",headers:{origin:"https://example.test","content-type":"application/json"},body:JSON.stringify({title:"New title",issueNumber:"1",publisher:"Example",actorUserId:directoryId})}),deps);
  assert.equal(custom.status,201); assert.equal(context?.userId,actorId); assert.equal(values?.[7],actorId);
  const body={targetDirectoryId:directoryId,expectedSourceVersion:"1",expectedTargetVersion:"1",requestId:"a0000000-0000-4000-8000-000000000001",actorUserId:directoryId};
  const nonAdmin=await handleMergeReviewRequest(new Request("https://example.test/",{method:"POST",headers:{origin:"https://example.test","content-type":"application/json"},body:JSON.stringify(body)}),deps,"90000000-0000-4000-8000-000000000001");
  assert.equal(nonAdmin.status,403);
});
test("cookie/BFF mutations fail closed on origin/content type and reject malformed or oversized streamed bytes before SQL",async()=>{
  let queries=0;const query=db([],()=>{queries++;});const deps=dependencies(query);deps.maxMutationBodyBytes=64;
  const validHeaders={origin:"https://example.test","content-type":"application/json"};
  const examples:Array<{headers:Record<string,string>,body:string,status:number}>=[
    {headers:{...validHeaders,origin:"https://evil.test"},body:'{}',status:403},
    {headers:{"content-type":"application/json"},body:'{}',status:403},
    {headers:{...validHeaders,"content-type":"text/plain"},body:'{}',status:415},
    {headers:validHeaders,body:'{"broken":',status:400},
    {headers:validHeaders,body:JSON.stringify({title:"é".repeat(40)}),status:413},
    {headers:{...validHeaders,"content-length":"1"},body:JSON.stringify({title:"é".repeat(40)}),status:413},
  ];
  for(const example of examples) {
    const result=await handleCustomDirectoryRequest(new Request("https://example.test/api/directory/custom",{method:"POST",headers:example.headers,body:example.body}),deps);
    assert.equal(result.status,example.status);
  }
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"title":"'));controller.enqueue(new TextEncoder().encode("a".repeat(65)));controller.close();}});
  const streamed=await handleCustomDirectoryRequest(new Request("https://example.test/api/directory/custom",{method:"POST",headers:validHeaders,body:stream,duplex:"half"} as RequestInit & {duplex:"half"}),deps);
  assert.equal(streamed.status,413);assert.equal(queries,0);
});
test("session transaction rolls back a rejected commit, releases connection and uses fixed role SQL",async()=>{
  const statements:Array<{sql:string,values?:unknown[]}> = [];let released=false;
  const query:Queryable={async query<T extends Row>(sql:string,values?:unknown[]) {
    statements.push({sql,values}); if(sql==="COMMIT") throw Object.assign(new Error("deferred check rejected"),{code:"23514"});
    return {rows:[] as T[]};
  }};
  const sessions=postgresSessionDatabase({async connect(){return {...query,release(){released=true;}};}});
  await assert.rejects(()=>sessions.withSession({userId:actorId,role:"comichuddle_valuator",reviewPreview:true},async()=>"result"),/deferred check rejected/);
  assert.equal(released,true); assert.equal(statements.at(-1)?.sql,"ROLLBACK");
  assert.equal(statements[1].sql,"SET LOCAL ROLE comichuddle_valuator");
  assert.deepEqual(statements[2].values,[actorId,"true"]);
});
