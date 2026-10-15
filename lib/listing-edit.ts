import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '../db';
import {listings,profiles} from '../db/schema';
import {catalogIssuesById} from './catalog-store';
import {ApiRequestError,isRestricted} from './api-security';
import {previewRulesVersion} from './community';
import {listingDirectoryId} from './shared-catalog';
import {listingItems,closeListingStatements} from './marketplace';
import {emptyListingDraft,listingDraftSchema} from './listing-draft';
import {conditionalGuard,operationGuardFailed} from './operation-guard';
import {ensureSellerPhotos} from './seller-photos';
/** Editing an unsold fixed-price listing first unpublishes it into a private
 * draft. Purchased snapshots and accepted auction history are never rewritten. */
export async function prepareListingEdit(db:ReturnType<typeof getDb>,userId:string,listingId:string){
 const [seller]=await db.select().from(profiles).where(eq(profiles.userId,userId));
 if(!seller||seller.moderated||seller.deletionStartedAt||seller.rulesVersion!==previewRulesVersion||!seller.rulesAcceptedAt||await isRestricted(db,userId))throw new ApiRequestError('An active collector profile is required.',403);
 const [row]=await db.select().from(listings).where(and(eq(listings.id,listingId),eq(listings.sellerId,seller.id)));
 if(!row)throw new ApiRequestError('Listing not found.',404);
 if(row.status!=='active'||row.saleType!=='fixed')throw new ApiRequestError('Only an active, unsold fixed-price listing can be edited. Auction history requires support review.',409);
 const photos=JSON.parse(row.photos);await ensureSellerPhotos(userId,photos);
 const items=listingItems(row),ids=[...new Set(items.flatMap(item=>{const id=listingDirectoryId(item);return id===null?[]:[id]}))],records=new Map((await catalogIssuesById(db,ids)).map(issue=>[issue.id,issue]));
 const draft=listingDraftSchema.parse({...emptyListingDraft(),step:0,title:row.title,description:row.description,price:(row.price/100).toFixed(2),shipping:(row.shipping/100).toFixed(2),locationZip:row.locationZip,fulfillment:row.fulfillment,pickupCity:row.pickupCity,pickupState:row.pickupState,safePurchase:!!row.safePurchaseOptIn,photos,owned:true,usa:true,rows:items.map(item=>{const issueId=listingDirectoryId(item),issue=issueId===null?undefined:records.get(issueId);return {id:crypto.randomUUID(),issueId,title:item.title,issue:item.issue,publisher:issue?.publisher||'',year:issue?.year||0,variant:issue?.variant||'',copyIds:[item.bookId],condition:item.condition||{}}})});
 const guard=conditionalGuard(db,sql`EXISTS(SELECT 1 FROM listings WHERE id=${row.id} AND seller_id=${seller.id} AND status='active' AND sale_type='fixed' AND items=${row.items} AND photos=${row.photos} AND price=${row.price} AND shipping=${row.shipping}) AND NOT EXISTS(SELECT 1 FROM commerce_orders WHERE listing_id=${row.id} AND status NOT IN ('cancelled','refunded','checkout_expired')) AND NOT EXISTS(SELECT 1 FROM collector_listing_drafts WHERE user_id=${userId})`),revision=crypto.randomUUID();
 try{await db.batch([guard.start,...closeListingStatements(db,eq(listings.id,row.id),'withdrawn'),db.execute(sql`INSERT INTO ch_web.collector_listing_drafts(user_id,revision,data) VALUES(${userId},${revision}::uuid,${JSON.stringify(draft)}::jsonb)`),guard.finish])}
 catch(error){if(operationGuardFailed(error)||(error as {cause?:{code?:string}}).cause?.code==='23505')throw new ApiRequestError('A purchase or saved draft prevents editing. Open your existing listing draft first; no listing was changed.',409);throw error}
 return {saved:true,revision,note:'The original listing is unpublished. Review the private draft and publish a new listing when ready.'};
}
