import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import type {CatalogDb} from './catalog-store';
import type {EstimateTarget} from './estimated-fmv-types';
import {approvedSourceFetch} from './cover-source-fetch';
const transaction=z.object({id:z.string().min(1).max(160),sourceUrl:z.string().url().max(1000),targetKey:z.string().regex(/^[a-f0-9]{64}$/),itemCents:z.number().int().positive().max(10000000000),shippingCents:z.number().int().nonnegative(),taxCents:z.number().int().nonnegative(),premiumCents:z.number().int().nonnegative(),discountCents:z.number().int().nonnegative(),subsidyCents:z.number().int().nonnegative(),currency:z.literal('USD'),priceBasis:z.literal('item_only'),status:z.enum(['confirmed_paid','published_auction_result','asking','active_bid','ended_unsold','cancelled','refunded']),amountKnown:z.boolean(),acceptedOffer:z.boolean(),acceptedOfferAmountKnown:z.boolean(),soldAt:z.string().datetime(),independentEntityKey:z.string().min(5).max(200),independenceReviewed:z.boolean(),exactEditionAndCondition:z.boolean(),quantity:z.literal(1),originalObservation:z.literal(true)}).strict();
/** Adapter for an actually permissioned original transaction feed. This does
 * not scrape eBay or imply access merely because a provider token exists. */
export async function ingestExternalEvidence(db:CatalogDb,target:EstimateTarget,targetKey:string){
 const endpoint=process.env.COMICHUDDLE_EXTERNAL_COMPS_URL,provider=process.env.COMICHUDDLE_EXTERNAL_COMPS_PROVIDER,token=process.env.COMICHUDDLE_EXTERNAL_COMPS_TOKEN;
 if(!endpoint||!provider||!token)return {connected:false,imported:0,reason:'No external transaction feed is configured.'};
 const grants=await db.execute(sql`SELECT * FROM ch_web.source_permissions WHERE provider=${provider} AND enabled AND access_allowed AND ai_allowed AND valuation_allowed AND display_allowed AND cache_allowed AND revoked_at IS NULL AND valid_until>now()`),grant=grants.rows[0];if(!grant)return {connected:false,imported:0,reason:'External-source access, retention, AI-processing and display permission has not been reviewed.'};
 const hosts=grant.approved_hosts as string[],url=new URL(endpoint);if(url.protocol!=='https:'||!hosts.includes(url.hostname)||url.username||url.password)throw Error('Invalid approved transaction feed endpoint.');
 url.searchParams.set('target',JSON.stringify({issueId:target.issueId,title:target.title,number:target.number,year:target.year,variant:target.variant,language:target.language,condition:target.condition}));url.searchParams.set('target_key',targetKey);
 const response=await approvedSourceFetch(url.href,hosts,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},maxBytes:1000000}),body=z.object({transactions:z.array(transaction).max(100)}).parse(JSON.parse(response.bytes.toString()));let imported=0;
 for(const row of body.transactions){
  if(row.targetKey!==targetKey||!['confirmed_paid','published_auction_result'].includes(row.status)||!row.amountKnown||row.acceptedOffer&&!row.acceptedOfferAmountKnown||!row.independenceReviewed||!row.exactEditionAndCondition||row.discountCents||row.subsidyCents||Date.parse(row.soldAt)>Date.now()||Date.now()-Date.parse(row.soldAt)>90*86400000)continue;
  const source=new URL(row.sourceUrl);if(source.protocol!=='https:'||!hosts.includes(source.hostname))continue;
  // Original-source identity, not the syndicating feed name: two licensed
  // feeds describing the same sale cannot manufacture two independent comps.
  const id=createHash('sha256').update(source.origin+':'+row.id).digest('hex'),entity=createHash('sha256').update(source.origin+':'+row.independentEntityKey).digest('hex');
  const result=await db.execute(sql`INSERT INTO ch_web.valuation_observations(id,target_key,source_provider,kind,low_cents,high_cents,currency,observed_at,independent_entity_key,source_url,evidence_reference,eligible,original_observation,reviewed_at,expires_at,details)
  VALUES(${id},${targetKey},${provider},'sale',${row.itemCents},${row.itemCents},'USD',${row.soldAt}::timestamptz,${entity},${row.sourceUrl},${String(grant.evidence_reference)},true,true,now(),LEAST(${new Date(String(grant.valid_until)).toISOString()}::timestamptz,now()+interval '30 days'),${JSON.stringify({status:row.status,shippingCents:row.shippingCents,taxCents:row.taxCents,premiumCents:row.premiumCents,discountCents:0,subsidyCents:0,actualAcceptedOfferAmountKnown:row.acceptedOfferAmountKnown})}::jsonb)
  ON CONFLICT(id) DO NOTHING RETURNING id`);imported+=result.rows.length;
 }
 return {connected:true,imported,reason:null};
}
