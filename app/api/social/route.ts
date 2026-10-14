import {publicOwnedCopy} from '../../../lib/collection-entry';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {profiles,collections,groups,memberships,groupPosts,groupPostReplies,groupPostReactions,threads,messages,blocks,listings,offers,swipes,media,reports,careProviders,careReviews,careJobs,careEvents,accountRestrictions,writeLimits,auctionBids,listingInventory,commerceOrders,commerceSellers,tradeProposals} from '../../../db/schema';
import {and,eq,or,desc,asc,inArray,count,sql,type SQL,type SQLWrapper} from 'drizzle-orm';
import {z} from 'zod';
import {catalog} from '../../../lib/catalog';
import {emptyVault,vaultSchema,type Vault} from '../../../lib/vault';
import {starterGroups,groupChannels,previewRulesVersion,communityPostKinds,type CommunityPost,type CommunityGroup,type CommunityData,type CommunityThread} from '../../../lib/community';
import {ApiRequestError,enforceWriteLimits,isRestricted,privateJson,chunks,blockedPeerIds} from '../../../lib/api-security';
import {bookIssue} from '../../../lib/trades';
import {ownerAccountId} from '../../../lib/owner';
import {env} from '../../../lib/runtime-env';
import {blocked,beginThread} from '../../../lib/conversations';
import {careIntakeForViewer} from '../../../lib/pressing';
import {commerceAccountData} from '../../../lib/commerce';
import {conditionalGuard,operationGuardFailed} from '../../../lib/operation-guard';
import {readSocialObject,createListing,proposeListingTrade,readTradeTerms,tradeTermsAccountData,decideTradeTerms,listingContext,listingDto,placeBid,retractBid,checkMarketplaceDeletion,anonymizeMarketplaceHistory,closeListingStatements,withdrawListing,marketplaceGuardFailed} from '../../../lib/marketplace';
const text=(n:number)=>z.string().trim().min(1).max(n);const id=z.string().min(1).max(100);const now=()=>new Date().toISOString();
type Db=ReturnType<typeof getDb>;type P=typeof profiles.$inferSelect;
const json=privateJson;
async function ownedVault(db:Db,userId:string){const [row]=await db.select().from(collections).where(eq(collections.userId,userId));return row?vaultSchema.parse(JSON.parse(row.data)):emptyVault('Collector')}
type ProfileRelated={vaults:Map<string,Vault>;providers:Map<string,typeof careProviders.$inferSelect>};
async function profileRelated(db:Db,people:P[]):Promise<ProfileRelated>{const vaults=new Map<string,Vault>(),providers=new Map<string,typeof careProviders.$inferSelect>();for(const batch of chunks(people)){const [rows,care]=await Promise.all([db.select().from(collections).where(inArray(collections.userId,batch.map(p=>p.userId))),db.select().from(careProviders).where(inArray(careProviders.profileId,batch.map(p=>p.id)))]);for(const row of rows)vaults.set(row.userId,vaultSchema.parse(JSON.parse(row.data)));for(const row of care)providers.set(row.profileId,row)}return {vaults,providers}}
async function profilesById(db:Db,ids:string[]){const found=new Map<string,P>();for(const batch of chunks([...new Set(ids)])){for(const p of await db.select().from(profiles).where(inArray(profiles.id,batch)))found.set(p.id,p)}return found}
async function profileDto(db:Db,p:P,own=false,related?:ProfileRelated){const v=related?related.vaults.get(p.userId)||emptyVault('Collector'):await ownedVault(db,p.userId);const care=related?related.providers.get(p.id):(await db.select().from(careProviders).where(eq(careProviders.profileId,p.id)))[0];const featureIds=JSON.parse(p.featured) as string[];const showcase=v.books.filter(b=>featureIds.includes(b.id)).slice(0,6).map(publicOwnedCopy);const counts:Record<string,number>={};v.books.forEach(b=>{const issue=bookIssue(b);const pub=issue?.publisher||'Other';counts[pub]=(counts[pub]||0)+1});return {...(own?{moderated:!!p.moderated,consent:p.rulesVersion&&p.rulesAcceptedAt?{version:p.rulesVersion,acceptedAt:p.rulesAcceptedAt}:undefined}:{}),...(care?.visible?{provider:{id:care.id,name:care.name}}:{}),id:p.id,handle:p.handle,name:p.name,bio:p.bio,tagline:p.tagline,location:p.location,favorite:p.favorite,since:p.since,color:p.color,visible:!!p.visible,dmOpen:!!p.dmOpen,createdAt:p.createdAt,featured:featureIds,stats:{comics:v.books.length,wants:v.wants.length,trades:v.tradeBookIds.filter(i=>v.books.some(b=>b.id===i)).length,publishers:Object.entries(counts).map(([name,count])=>({name,count}))},showcase,tradeBooks:v.books.filter(b=>v.tradeBookIds.includes(b.id)).slice(0,15).map(publicOwnedCopy),wantIds:v.wants};}
async function seedGroups(db:Db){await db.insert(groups).values(starterGroups.map(g=>({...g,ownerId:null,createdAt:'2026-10-08T00:00:00.000Z'}))).onConflictDoNothing();}
async function joined(db:Db,p:string,g:string){return (await db.select().from(memberships).where(and(eq(memberships.profileId,p),eq(memberships.groupId,g)))).length>0}
// A hidden showcase may participate privately inside joined groups. Public
// discovery visibility is not a substitute for actual group membership.
function communityPerson(profileId:SQLWrapper,viewer?:P){return sql`EXISTS (SELECT 1 FROM profiles cp WHERE cp.id = ${profileId} AND cp.moderated = 0 AND cp.deletion_started_at IS NULL AND NOT EXISTS (SELECT 1 FROM account_restrictions cr WHERE cr.user_id = cp.user_id AND cr.scope = 'account')) AND ${viewer?sql`NOT EXISTS (SELECT 1 FROM blocks cb WHERE (cb.from_id = ${viewer.id} AND cb.to_id = ${profileId}) OR (cb.from_id = ${profileId} AND cb.to_id = ${viewer.id}))`:sql`true`}`}
function communityGroupVisible(viewer?:P){return sql`(${groups.ownerId} IS NULL OR ${communityPerson(groups.ownerId,viewer)})`}
function communityJoined(viewer:P|undefined,group:SQLWrapper=groups.id){return viewer?sql`EXISTS (SELECT 1 FROM memberships cm WHERE cm.profile_id = ${viewer.id} AND cm.group_id = ${group})`:sql`false`}
function communityActor(profile:P){return sql`EXISTS (SELECT 1 FROM profiles ca WHERE ca.id = ${profile.id} AND ca.user_id = ${profile.userId} AND ca.moderated = 0 AND ca.deletion_started_at IS NULL AND ca.rules_version = ${previewRulesVersion} AND ca.rules_accepted_at != '' AND NOT EXISTS (SELECT 1 FROM account_restrictions ar WHERE ar.user_id = ca.user_id AND ar.scope = 'account'))`}
function communityActivity(viewer?:P){return sql<string>`MAX(${groupPosts.createdAt},COALESCE((SELECT MAX(gr.created_at) FROM group_post_replies gr WHERE gr.post_id = ${groupPosts.id} AND ${communityPerson(sql`gr.profile_id`,viewer)}),${groupPosts.createdAt}))`}
function communityPostCounts(viewer?:P){return {
 likeCount:sql<number>`(SELECT COUNT(*) FROM group_post_reactions gl WHERE gl.post_id = ${groupPosts.id} AND ${communityPerson(sql`gl.profile_id`,viewer)})`,
 replyCount:sql<number>`(SELECT COUNT(*) FROM group_post_replies gr WHERE gr.post_id = ${groupPosts.id} AND ${communityPerson(sql`gr.profile_id`,viewer)})`,
 liked:viewer?sql<number>`EXISTS (SELECT 1 FROM group_post_reactions mine WHERE mine.post_id = ${groupPosts.id} AND mine.profile_id = ${viewer.id})`:sql<number>`0`,
 lastActiveAt:communityActivity(viewer)
}}
function communitySelection(db:Db,viewer?:P){return db.select({post:groupPosts,group:groups,author:profiles,...communityPostCounts(viewer)}).from(groupPosts).innerJoin(groups,eq(groups.id,groupPosts.groupId)).innerJoin(profiles,eq(profiles.id,groupPosts.profileId))}
type CommunityRow=Awaited<ReturnType<ReturnType<typeof communitySelection>['execute']>>[number];
function communityPostDto(row:CommunityRow,viewer?:P):CommunityPost{return {id:row.post.id,groupId:row.group.id,group:{id:row.group.id,name:row.group.name,color:row.group.color},channel:row.post.channel,kind:communityPostKinds.includes(row.post.kind as typeof communityPostKinds[number])?row.post.kind as typeof communityPostKinds[number]:'discussion',title:row.post.title,body:row.post.body,photoId:row.post.photoId,createdAt:row.post.createdAt,lastActiveAt:row.lastActiveAt,author:{id:row.author.id,name:row.author.name,handle:row.author.handle,color:row.author.color},canDelete:row.post.profileId===viewer?.id||row.group.ownerId===viewer?.id,liked:!!row.liked,likeCount:Number(row.likeCount),replyCount:Number(row.replyCount)}}
function communitySearch(q:string,columns:SQLWrapper[]){const needle='%'+q.replace(/[\\%_]/g,'\\$&')+'%';return q?sql`(${sql.join(columns.map(column=>sql`${column} LIKE ${needle} ESCAPE '\\'`),sql` OR `)})`:sql`true`}
type CommunityCursor={at:string;id:string;scope:string};
function encodeCommunityCursor(value:CommunityCursor){return Array.from(new TextEncoder().encode(JSON.stringify(value)),byte=>byte.toString(16).padStart(2,'0')).join('')}
function decodeCommunityCursor(value:string|null,scope:string):CommunityCursor|null{
 if(!value)return null;if(value.length>2048||! /^(?:[a-f0-9]{2})+$/.test(value))throw new ApiRequestError('Refresh this community page; its cursor is invalid.',400);
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(value.match(/../g)!.map(v=>parseInt(v,16)))))}catch{throw new ApiRequestError('Refresh this community page; its cursor is invalid.',400)}
 const cursor=z.object({at:z.string().datetime(),id:id,scope:z.string().max(500)}).strict().safeParse(parsed);if(!cursor.success||cursor.data.scope!==scope)throw new ApiRequestError('Refresh after changing the community filters.',400);return cursor.data;
}
async function communityGroups(db:Db,viewer:P|undefined,where:SQL,limit=50){
 const rows=await db.select({group:groups,owner:profiles,members:sql<number>`(SELECT COUNT(*) FROM memberships gm WHERE gm.group_id = ${groups.id} AND ${communityPerson(sql`gm.profile_id`,viewer)})`,joined:communityJoined(viewer),postCount:sql<number>`(SELECT COUNT(*) FROM group_posts gp WHERE gp.group_id = ${groups.id} AND ${communityPerson(sql`gp.profile_id`,viewer)})`,lastActiveAt:sql<string|null>`(SELECT MAX(MAX(gp.created_at,COALESCE((SELECT MAX(gr.created_at) FROM group_post_replies gr WHERE gr.post_id = gp.id AND ${communityPerson(sql`gr.profile_id`,viewer)}),gp.created_at))) FROM group_posts gp WHERE gp.group_id = ${groups.id} AND ${communityPerson(sql`gp.profile_id`,viewer)})`}).from(groups).leftJoin(profiles,eq(profiles.id,groups.ownerId)).where(and(communityGroupVisible(viewer),where)).orderBy(desc(groups.createdAt),desc(groups.id)).limit(limit);
 return rows.map(row=>({...row.group,members:Number(row.members),joined:!!row.joined,postCount:Number(row.postCount),lastActiveAt:row.lastActiveAt,owner:row.owner?{id:row.owner.id,name:row.owner.name,handle:row.owner.handle}:null,canManage:row.group.ownerId===viewer?.id})) as CommunityGroup[];
}
async function communityView(db:Db,viewer:P|undefined,url:URL,signedIn:boolean):Promise<CommunityData>{
 const parsed=z.object({view:z.enum(['feed','group','discover']).default('feed'),group:z.string().max(100).default(''),channel:z.enum(['general','showcase','trading']).optional(),sort:z.enum(['recent','active']).default('recent'),q:z.string().trim().max(80).default('')}).parse(Object.fromEntries(['view','group','channel','sort','q'].flatMap(key=>url.searchParams.has(key)?[[key,url.searchParams.get(key)]]:[])));
 const eligible=viewer&&!viewer.moderated&&!viewer.deletionStartedAt&&!await isRestricted(db,viewer.userId)?viewer:undefined;
 const scope=JSON.stringify(parsed),cursor=decodeCommunityCursor(url.searchParams.get('cursor'),scope);
 const joinedCount=eligible?Number((await db.select({n:count()}).from(groups).where(and(communityJoined(eligible),communityGroupVisible(eligible))))[0].n):0;
 const base={view:parsed.view,groups:[] as CommunityGroup[],activeGroup:null,posts:[] as CommunityPost[],nextCursor:null,hasMore:false,joinedCount,...(!signedIn?{signInRequired:true}:!viewer?{profileRequired:true}:{})};
 if(parsed.view==='discover'){
  const criteria=and(communitySearch(parsed.q,[groups.name,groups.description]),cursor?sql`(${groups.createdAt} < ${cursor.at} OR (${groups.createdAt} = ${cursor.at} AND ${groups.id} < ${cursor.id}))`:undefined)!;
  const found=await communityGroups(db,eligible,criteria,31),page=found.slice(0,30),last=page.at(-1),extra=found.length>30;
  return {...base,groups:page,hasMore:extra,nextCursor:extra&&last?encodeCommunityCursor({at:found[29].createdAt,id:last.id,scope}):null};
 }
 const mine=eligible?await communityGroups(db,eligible,communityJoined(eligible)):[];
 let activeGroup:CommunityGroup|null=null;if(parsed.view==='group'){if(!parsed.group)throw new ApiRequestError('Choose a community group.',400);activeGroup=(await communityGroups(db,eligible,eq(groups.id,parsed.group),1))[0]||null;if(!activeGroup)throw new ApiRequestError('Group not found.',404)}
 if(!eligible||activeGroup&&!activeGroup.joined)return {...base,groups:mine,activeGroup,joinRequired:!!activeGroup&&!activeGroup.joined};
 const time=parsed.sort==='active'?communityActivity(eligible):groupPosts.createdAt;
 const rows=await communitySelection(db,eligible).where(and(communityJoined(eligible),communityGroupVisible(eligible),communityPerson(groupPosts.profileId,eligible),parsed.view==='group'?eq(groupPosts.groupId,parsed.group):undefined,parsed.channel?eq(groupPosts.channel,parsed.channel):undefined,communitySearch(parsed.q,[groupPosts.title,groupPosts.body]),cursor?sql`(${time} < ${cursor.at} OR (${time} = ${cursor.at} AND ${groupPosts.id} < ${cursor.id}))`:undefined)).orderBy(desc(time),desc(groupPosts.id)).limit(21);
 const posts=rows.slice(0,20).map(row=>communityPostDto(row,eligible)),last=posts.at(-1),hasMore=rows.length>20;
 return {...base,groups:mine,activeGroup,posts,hasMore,nextCursor:hasMore&&last?encodeCommunityCursor({at:parsed.sort==='active'?last.lastActiveAt:last.createdAt,id:last.id,scope}):null};
}
async function communityThread(db:Db,viewer:P|undefined,url:URL):Promise<CommunityThread>{
 if(!viewer||viewer.moderated||viewer.deletionStartedAt||await isRestricted(db,viewer.userId))throw new ApiRequestError('Create an eligible collector profile to enter this conversation.',403);
 const postId=id.parse(url.searchParams.get('post')),scope=JSON.stringify({post:postId}),cursor=decodeCommunityCursor(url.searchParams.get('cursor'),scope);
 const [row]=await communitySelection(db,viewer).where(and(eq(groupPosts.id,postId),communityJoined(viewer),communityGroupVisible(viewer),communityPerson(groupPosts.profileId,viewer))).limit(1);
 if(!row)throw new ApiRequestError('Conversation not found. Join its group to read member posts.',404);
 const rows=await db.select({reply:groupPostReplies,author:profiles}).from(groupPostReplies).innerJoin(profiles,eq(profiles.id,groupPostReplies.profileId)).where(and(eq(groupPostReplies.postId,postId),communityPerson(groupPostReplies.profileId,viewer),cursor?sql`(${groupPostReplies.createdAt} > ${cursor.at} OR (${groupPostReplies.createdAt} = ${cursor.at} AND ${groupPostReplies.id} > ${cursor.id}))`:undefined)).orderBy(asc(groupPostReplies.createdAt),asc(groupPostReplies.id)).limit(31);
 const replies=rows.slice(0,30).map(({reply,author})=>({id:reply.id,postId:reply.postId,body:reply.body,createdAt:reply.createdAt,author:{id:author.id,name:author.name,handle:author.handle,color:author.color},canDelete:reply.profileId===viewer.id||row.group.ownerId===viewer.id})),last=replies.at(-1),hasMore=rows.length>30;
 return {post:communityPostDto(row,viewer),replies,hasMore,nextCursor:hasMore&&last?encodeCommunityCursor({at:last.createdAt,id:last.id,scope}):null};
}
function communityWriteGuard(db:Db,viewer:P,groupId:string,extra:SQL=sql`true`){return conditionalGuard(db,sql`${communityActor(viewer)} AND EXISTS (SELECT 1 FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.profile_id = ${viewer.id} AND m.group_id = ${groupId} AND (g.owner_id IS NULL OR ${communityPerson(sql`g.owner_id`,viewer)})) AND ${extra}`)}
async function communityBatch(db:Db,statements:Parameters<Db['batch']>[0]){try{return await db.batch(statements)}catch(error){if(operationGuardFailed(error))throw new ApiRequestError('This group, membership or conversation changed. Refresh before trying again.',409);throw error}}
function removeCommunityPosts(db:Db,where:SQL){const ids=db.select({id:groupPosts.id}).from(groupPosts).where(where);return [db.delete(reports).where(and(eq(reports.targetType,'post_reply'),inArray(reports.targetId,db.select({id:groupPostReplies.id}).from(groupPostReplies).where(inArray(groupPostReplies.postId,ids))))),db.delete(reports).where(and(eq(reports.targetType,'post'),inArray(reports.targetId,ids))),db.delete(groupPostReplies).where(inArray(groupPostReplies.postId,ids)),db.delete(groupPostReactions).where(inArray(groupPostReactions.postId,ids)),db.delete(groupPosts).where(where)] as const}
async function canReport(db:Db,me:P,type:string,targetId:string):Promise<boolean>{
 if(type==='message'){const [message]=await db.select().from(messages).where(eq(messages.id,targetId));if(!message)return false;const [thread]=await db.select().from(threads).where(eq(threads.id,message.threadId));return !!thread&&[thread.a,thread.b].includes(me.id)}
 if(type==='post'||type==='post_reply'){const [reply]=type==='post_reply'?await db.select().from(groupPostReplies).where(eq(groupPostReplies.id,targetId)):[];const [post]=await db.select().from(groupPosts).where(eq(groupPosts.id,type==='post_reply'?reply?.postId||'':targetId));if(!post||!await joined(db,me.id,post.groupId)||await blocked(db,me.id,post.profileId)||reply&&await blocked(db,me.id,reply.profileId))return false;return (await communitySelection(db,me).where(and(eq(groupPosts.id,post.id),communityGroupVisible(me),communityPerson(groupPosts.profileId,me),reply?communityPerson(sql`${reply.profileId}`,me):undefined)).limit(1)).length>0}
 if(type==='profile'){const [profile]=await db.select().from(profiles).where(eq(profiles.id,targetId));return !!profile&&(!!profile.visible||profile.id===me.id)&&!await blocked(db,me.id,profile.id)}
 if(type==='listing'){const [listing]=await db.select().from(listings).where(eq(listings.id,targetId));if(!listing||!['active','ended'].includes(listing.status))return false;const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));return !!seller?.visible&&!seller.moderated&&!await blocked(db,me.id,seller.id)}
 const [review]=type==='care_review'?await db.select().from(careReviews).where(eq(careReviews.id,targetId)):[];
 const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,type==='care_review'?review?.providerId||'':targetId));
 if(!provider?.visible||provider.moderated)return false;const [owner]=await db.select().from(profiles).where(eq(profiles.id,provider.profileId));
 return !!owner?.visible&&!owner.moderated&&!await blocked(db,me.id,owner.id)&&(!review||!await blocked(db,me.id,review.authorId));
}
async function exportAccount(db:Db,userId:string,me:P|undefined){
 const security={restrictions:await db.select().from(accountRestrictions).where(eq(accountRestrictions.userId,userId)),activeWriteLimits:await db.select({windowStart:writeLimits.windowStart,requests:writeLimits.requests,expiresAt:writeLimits.expiresAt}).from(writeLimits).where(eq(writeLimits.userId,userId))};const collection=await ownedVault(db,userId),assets=await db.select({id:media.id,contentType:media.contentType,createdAt:media.createdAt}).from(media).where(eq(media.userId,userId));
 const commerce=await commerceAccountData(db,userId),tradeTerms=me?await tradeTermsAccountData(db,me.id):[];
 if(!me)return {exportedAt:now(),profile:null,collection,photos:assets,security,commerce};
 const conversations=await db.select().from(threads).where(or(eq(threads.a,me.id),eq(threads.b,me.id)));
 const conversationIds=conversations.map(t=>t.id),ownListings=await db.select().from(listings).where(eq(listings.sellerId,me.id));
 const jobs=await db.select().from(careJobs).where(or(eq(careJobs.requesterId,me.id),eq(careJobs.providerProfileId,me.id)));
 const [posts,memberOf,ownedGroups,sentOffers,reviews,provider,blockedCollectors,swipeHistory,sentReports,bids,reservations]=await Promise.all([
  db.select().from(groupPosts).where(eq(groupPosts.profileId,me.id)),db.select().from(memberships).where(eq(memberships.profileId,me.id)),db.select().from(groups).where(eq(groups.ownerId,me.id)),
  db.select().from(offers).where(or(eq(offers.buyerId,me.id),inArray(offers.listingId,db.select({id:listings.id}).from(listings).where(eq(listings.sellerId,me.id))))),
  db.select().from(careReviews).where(eq(careReviews.authorId,me.id)),db.select().from(careProviders).where(eq(careProviders.profileId,me.id)),
  db.select().from(blocks).where(eq(blocks.fromId,me.id)),db.select().from(swipes).where(eq(swipes.fromId,me.id)),db.select().from(reports).where(eq(reports.profileId,me.id)),
  db.select().from(auctionBids).where(eq(auctionBids.bidderId,me.id)),db.select().from(listingInventory).where(eq(listingInventory.sellerId,me.id))]);
 const privateMessages=conversationIds.length?await db.select().from(messages).where(inArray(messages.threadId,db.select({id:threads.id}).from(threads).where(or(eq(threads.a,me.id),eq(threads.b,me.id))))):[];
 const events=jobs.length?await db.select().from(careEvents).where(inArray(careEvents.jobId,db.select({id:careJobs.id}).from(careJobs).where(or(eq(careJobs.requesterId,me.id),eq(careJobs.providerProfileId,me.id))))):[];
 const [postReplies,postReactions]=await Promise.all([db.select().from(groupPostReplies).where(eq(groupPostReplies.profileId,me.id)),db.select().from(groupPostReactions).where(eq(groupPostReactions.profileId,me.id))]);
 const marketContext=await listingContext(db,ownListings,me.id);
 return {exportedAt:now(),security,commerce,tradeTerms,profile:await profileDto(db,me,true),consent:{version:me.rulesVersion,acceptedAt:me.rulesAcceptedAt},collection,photos:assets,listings:ownListings.map(l=>listingDto(l,me,me.id,marketContext)),bids,reservations,offers:sentOffers,posts,postReplies,postReactions,memberships:memberOf,ownedGroups,conversations,messages:privateMessages,blocks:blockedCollectors,swipes:swipeHistory,reports:sentReports,careProvider:provider[0]?{...provider[0],portfolio:JSON.parse(provider[0].portfolio),services:JSON.parse(provider[0].services),prices:JSON.parse(provider[0].prices)}:null,careReviews:reviews,careJobs:jobs.map(j=>({...j,...careIntakeForViewer(j,me.id),books:JSON.parse(j.books),services:JSON.parse(j.services)})),careEvents:events.map(e=>({...e,photos:JSON.parse(e.photos)}))};
}
export async function GET(req:Request){try{const u=await getChatGPTUser(),url=new URL(req.url),kind=url.searchParams.get('kind');if(!u&&kind!=='community')return json({error:'Sign in with ChatGPT to continue.'},401);const db=getDb();await seedGroups(db);const [me]=u?await db.select().from(profiles).where(eq(profiles.userId,u.userId)):[];
if(kind==='community')return json(await communityView(db,me,url,!!u));
if(!u)return json({error:'Sign in with ChatGPT to continue.'},401);
if(kind==='post')return json(await communityThread(db,me,url));
if(kind==='trade_terms')return json(await readTradeTerms(db,me,url.searchParams.get('thread')||'',url.searchParams.get('cursor')||undefined));
if(kind==='export')return json(await exportAccount(db,u.userId,me),200,{'Content-Disposition':'attachment; filename="comichuddle-account.json"'});
if(kind==='auctions_admin'){
 if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);
 const exact=url.searchParams.get('id');if(exact&&!z.string().uuid().safeParse(exact).success)return json({error:'Enter a valid auction preview ID.'},400);
 const rows=await db.select().from(listings).where(and(eq(listings.saleType,'auction'),exact?eq(listings.id,exact):undefined)).orderBy(desc(listings.createdAt)).limit(100);
 const sellers=await profilesById(db,rows.map(row=>row.sellerId));
 return json({auctions:rows.map(row=>({id:row.id,title:row.title,status:row.status==='active'&&(!Number.isFinite(Date.parse(row.endAt))||Date.parse(row.endAt)<=Date.now())?'ended':row.status,endAt:row.endAt,bidCount:row.bidCount,price:row.price,currentBid:row.currentBid,seller:{name:sellers.get(row.sellerId)?.name||'Former collector',handle:sellers.get(row.sellerId)?.handle||''}}))});
}
if(kind==='restrictions'){if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);const rows=await db.select().from(accountRestrictions).orderBy(desc(accountRestrictions.createdAt)).limit(200);const restrictions=[];for(const row of rows){const [profile]=await db.select().from(profiles).where(eq(profiles.userId,row.userId));restrictions.push({...row,profile:profile?{id:profile.id,name:profile.name,handle:profile.handle}:null})}return json({restrictions})}
if(kind==='reports'){if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);const rows=await db.select().from(reports).orderBy(desc(reports.createdAt)).limit(100);const out=[];for(const row of rows){let content='Content unavailable';if(row.targetType==='post'){const [v]=await db.select().from(groupPosts).where(eq(groupPosts.id,row.targetId));content=v?.body||content}if(row.targetType==='post_reply'){const [v]=await db.select().from(groupPostReplies).where(eq(groupPostReplies.id,row.targetId));content=v?.body||content}if(row.targetType==='message'){const [v]=await db.select().from(messages).where(eq(messages.id,row.targetId));content=v?.body||content}if(row.targetType==='profile'){const [v]=await db.select().from(profiles).where(eq(profiles.id,row.targetId));content=v?[v.name,v.bio,v.tagline].join(' · '):content}if(row.targetType==='listing'){const [v]=await db.select().from(listings).where(eq(listings.id,row.targetId));content=v?[v.title,v.description].join(' · '):content}if(row.targetType==='care_review'){const [v]=await db.select().from(careReviews).where(eq(careReviews.id,row.targetId));content=v?[v.title,v.body].join(' · '):content}if(row.targetType==='care_provider'){const [v]=await db.select().from(careProviders).where(eq(careProviders.id,row.targetId));content=v?[v.name,v.bio,v.terms].join(' · '):content}out.push({...row,content})}return json({reports:out});}
if(kind==='listing'){const [listing]=await db.select().from(listings).where(eq(listings.id,url.searchParams.get('id')||''));if(!listing)return json({error:'Listing not found.'},404);const [seller]=await db.select().from(profiles).where(eq(profiles.id,listing.sellerId));const own=seller?.userId===u.userId;if(!own&&(!['active','ended'].includes(listing.status)||!seller?.visible||seller.moderated||(me&&await blocked(db,me.id,listing.sellerId))))return json({error:'Listing not found.'},404);const context=await listingContext(db,[listing],me?.id);return json(listingDto(listing,seller,me?.id,context))}
if(kind==='profile'){const handle=url.searchParams.get('handle')?.toLowerCase()||'';const [p]=await db.select().from(profiles).where(eq(profiles.handle,handle));if(!p||(!p.visible&&p.userId!==u.userId)||(me&&await blocked(db,me.id,p.id)))return json({error:'Profile not found.'},404);return json(await profileDto(db,p,p.userId===u.userId));}
if(kind==='posts'){const groupId=url.searchParams.get('group')||'',channel=url.searchParams.get('channel')||'general';if(!me||me.moderated||me.deletionStartedAt||await isRestricted(db,me.userId)||!await joined(db,me.id,groupId))return json({posts:[],joined:false});if(!groupChannels.some(c=>c.id===channel))return json({error:'Channel not found.'},404);const rows=await communitySelection(db,me).where(and(eq(groupPosts.groupId,groupId),eq(groupPosts.channel,channel),communityGroupVisible(me),communityPerson(groupPosts.profileId,me))).orderBy(desc(groupPosts.createdAt),desc(groupPosts.id)).limit(100);return json({posts:rows.reverse().map(row=>communityPostDto(row,me)),joined:true});}
if(kind==='messages'){if(!me)return json({error:'Create your free collector profile first.'},403);const threadId=url.searchParams.get('thread')||'';const [t]=await db.select().from(threads).where(eq(threads.id,threadId));if(!t||![t.a,t.b].includes(me.id))return json({error:'Conversation not found.'},404);const rows=await db.select().from(messages).where(eq(messages.threadId,threadId)).orderBy(desc(messages.createdAt)).limit(100);const [peer]=await db.select().from(profiles).where(eq(profiles.id,t.a===me.id?t.b:t.a));return json({messages:rows.reverse().map(m=>({id:m.id,body:m.body,createdAt:m.createdAt,mine:m.profileId===me.id,authorName:m.profileId===me.id?me.name:peer?.name||'Collector'})),blocked:await blocked(db,t.a,t.b)});}
const [publicPeople,gs,ls,ts]=await Promise.all([
 db.select().from(profiles).where(eq(profiles.visible,1)).limit(50),db.select().from(groups).orderBy(desc(groups.createdAt)).limit(100),
 db.select().from(listings).where(inArray(listings.status,['active','ended'])).orderBy(desc(listings.createdAt)).limit(100),
 me?db.select().from(threads).where(or(eq(threads.a,me.id),eq(threads.b,me.id))).orderBy(desc(threads.createdAt)).limit(100):Promise.resolve([])]);
const peerIds=[...publicPeople.map(p=>p.id),...ls.map(l=>l.sellerId),...ts.map(t=>t.a===me?.id?t.b:t.a)];
const [related,personMap,hidden]=await Promise.all([profileRelated(db,me&&!publicPeople.some(p=>p.id===me.id)?[...publicPeople,me]:publicPeople),profilesById(db,peerIds),me?blockedPeerIds(db,me.id,peerIds):Promise.resolve(new Set<string>())]);
const people=[];for(const p of publicPeople){if(!p.moderated&&!hidden.has(p.id))people.push(await profileDto(db,p,false,related))}
const members=new Map<string,number>(),joinedGroups=new Set<string>();for(const batch of chunks(gs.map(g=>g.id))){const counts=await db.select({id:memberships.groupId,n:count()}).from(memberships).where(inArray(memberships.groupId,batch)).groupBy(memberships.groupId);for(const row of counts)members.set(row.id,row.n);if(me){for(const row of await db.select({id:memberships.groupId}).from(memberships).where(and(eq(memberships.profileId,me.id),inArray(memberships.groupId,batch))))joinedGroups.add(row.id)}}
const gsOut=gs.map(g=>({...g,members:members.get(g.id)||0,joined:joinedGroups.has(g.id)}));
const visibleListings=ls.filter(l=>{const seller=personMap.get(l.sellerId);return !!seller?.visible&&!seller.moderated&&!hidden.has(seller.id)});
const marketContext=await listingContext(db,visibleListings,me?.id);
const lsOut=visibleListings.map(l=>listingDto(l,personMap.get(l.sellerId),me?.id,marketContext));
const lastMessages=new Map<string,typeof messages.$inferSelect>();for(const batch of chunks(ts.map(t=>t.id))){const latest=await db.select().from(messages).where(inArray(messages.id,db.select({id:sql<string>`(SELECT latest.id FROM messages latest WHERE latest.thread_id = ${sql.raw('threads.id')} ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1)`}).from(threads).where(inArray(threads.id,batch))));for(const row of latest)lastMessages.set(row.threadId,row)}
const tsOut=ts.flatMap(t=>{const peer=personMap.get(t.a===me?.id?t.b:t.a);return peer?[{id:t.id,context:t.context,peer:{id:peer.id,name:peer.name,handle:peer.handle},createdAt:t.createdAt,latest:lastMessages.get(t.id)?.body}]:[]});
const [ownOffers,ownSwipes]=me?await Promise.all([
 db.select().from(offers).where(or(eq(offers.buyerId,me.id),inArray(offers.listingId,db.select({id:listings.id}).from(listings).where(eq(listings.sellerId,me.id))))).orderBy(desc(offers.createdAt)).limit(100),
 db.select({pair:swipes.pair,direction:swipes.direction}).from(swipes).where(eq(swipes.fromId,me.id))]):[[],[]];
return json({me:me?await profileDto(db,me,true,related):null,groups:gsOut,people,listings:lsOut,threads:tsOut,offers:ownOffers.map(o=>({...o,mine:o.buyerId===me?.id})),checkoutEnabled:false,swipes:ownSwipes});
}catch(e){if(e instanceof ApiRequestError)return json({error:e.message},e.status);if(e instanceof z.ZodError)return json({error:'Check the community filters and try again.'},400);return json({error:'Could not load collector data. Please retry.'},500)}}
export async function POST(req:Request){try{const u=await getChatGPTUser();if(!u)return json({error:'Sign in with ChatGPT to continue.'},401);if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request origin rejected.'},403);const db=getDb();const a=await readSocialObject(req);const action=typeof a.action==='string'?a.action:'unknown';const budgets:Record<string,number>={profile:20,join:30,create_group:10,post:10,post_reply:20,post_react:60,delete_post_reply:30,delete_post:30,start_thread:15,message:15,block:15,listing:10,trade_offer:10,trade_terms_decision:30,withdraw_listing:20,bid:20,retract_bid:20,cancel_auction:20,offer:10,offer_response:30,buy:15,swipe:80,report:5,review_report:60,review_restriction:20,delete_my_data:3};const limited=await enforceWriteLimits(db,u.userId,'social:'+(Object.hasOwn(budgets,action)?action:'unknown'),Object.hasOwn(budgets,action)?budgets[action]:5);if(limited)return limited;const [p]=await db.select().from(profiles).where(eq(profiles.userId,u.userId));
if(a.action==='cancel_auction'){if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);const v=z.object({listingId:id}).parse(a);const [listing]=await db.select().from(listings).where(eq(listings.id,v.listingId));if(!listing||listing.saleType!=='auction')return json({error:'Auction preview not found.'},404);await db.batch(closeListingStatements(db,eq(listings.id,listing.id),'cancelled'));return json({saved:true,note:'The nonbinding preview is cancelled. No payment or order was created.'})}
if(a.action==='review_report'){if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);const v=z.object({reportId:id,remove:z.boolean()}).parse(a);const [r]=await db.select().from(reports).where(eq(reports.id,v.reportId));if(!r)return json({error:'Report not found.'},404);if(v.remove){if(r.targetType==='post')await db.batch(removeCommunityPosts(db,eq(groupPosts.id,r.targetId)));if(r.targetType==='post_reply')await db.batch([db.delete(reports).where(and(eq(reports.targetType,'post_reply'),eq(reports.targetId,r.targetId))),db.delete(groupPostReplies).where(eq(groupPostReplies.id,r.targetId))]);if(r.targetType==='message')await db.delete(messages).where(eq(messages.id,r.targetId));if(r.targetType==='listing')await db.batch(closeListingStatements(db,eq(listings.id,r.targetId),sql`CASE WHEN ${listings.saleType} = 'auction' THEN 'cancelled' ELSE 'withdrawn' END`));if(r.targetType==='care_review')await db.delete(careReviews).where(eq(careReviews.id,r.targetId));if(r.targetType==='care_provider'){const [provider]=await db.select().from(careProviders).where(eq(careProviders.id,r.targetId));const [subject]=provider?await db.select().from(profiles).where(eq(profiles.id,provider.profileId)):[];await db.update(careProviders).set({visible:0,accepting:0,moderated:1}).where(eq(careProviders.id,r.targetId));if(subject)await db.insert(accountRestrictions).values({userId:subject.userId,scope:'provider',createdAt:now()}).onConflictDoNothing()}if(r.targetType==='profile'){const [subject]=await db.select().from(profiles).where(eq(profiles.id,r.targetId));if(subject)await db.batch([db.update(profiles).set({visible:0,dmOpen:0,moderated:1}).where(eq(profiles.id,subject.id)),db.insert(accountRestrictions).values({userId:subject.userId,scope:'account',createdAt:now()}).onConflictDoNothing(),...closeListingStatements(db,eq(listings.sellerId,subject.id),sql`CASE WHEN ${listings.saleType} = 'auction' THEN 'cancelled' ELSE 'withdrawn' END`),db.update(careProviders).set({visible:0,accepting:0}).where(eq(careProviders.profileId,subject.id))])}}await db.delete(reports).where(eq(reports.id,r.id));return json({saved:true});}
if(a.action==='review_restriction'){if(u.userId!==ownerAccountId)return json({error:'Owner access required.'},403);const v=z.object({userId:id,scope:z.enum(['account','provider']),restore:z.literal(true)}).parse(a);const [restriction]=await db.select().from(accountRestrictions).where(and(eq(accountRestrictions.userId,v.userId),eq(accountRestrictions.scope,v.scope)));if(!restriction)return json({error:'Restriction not found.'},404);const clear=db.delete(accountRestrictions).where(and(eq(accountRestrictions.userId,v.userId),eq(accountRestrictions.scope,v.scope)));if(v.scope==='account')await db.batch([clear,db.update(profiles).set({moderated:0}).where(eq(profiles.userId,v.userId))]);else await db.batch([clear,db.update(careProviders).set({moderated:0}).where(inArray(careProviders.profileId,db.select({id:profiles.id}).from(profiles).where(eq(profiles.userId,v.userId))))]);return json({saved:true})}
if(a.action==='delete_my_data'){
 z.object({confirm:z.literal('DELETE')}).parse(a);
 const [financialHistory]=await db.select({id:commerceOrders.id}).from(commerceOrders).where(or(eq(commerceOrders.buyerUserId,u.userId),eq(commerceOrders.sellerUserId,u.userId))).limit(1);
 if(financialHistory)return json({error:'Your account has sandbox order history. Contact maliktecks@gmail.com for a reviewed deletion and financial-record retention request.'},409);
 const assets=await db.select().from(media).where(eq(media.userId,u.userId));
 if(p){
  await checkMarketplaceDeletion(db,p);
  const custodyStatuses=['approved','in_transit','received','pressing','at_grading','returning'];
  const activeCustody=()=>db.select({id:careJobs.id}).from(careJobs).where(and(or(eq(careJobs.requesterId,p.id),eq(careJobs.providerProfileId,p.id)),inArray(careJobs.status,custodyStatuses))).limit(1);
  const custodyError='Complete your active pressing requests before deleting your account so shipping and condition records remain available.';
  if((await activeCustody()).length)return json({error:custodyError},409);
  const anonymize=anonymizeMarketplaceHistory(db,p);
  const careSafe=conditionalGuard(db,sql`NOT EXISTS (SELECT 1 FROM care_jobs custody WHERE (custody.requester_id = ${p.id} OR custody.provider_profile_id = ${p.id}) AND custody.status IN ('approved','in_transit','received','pressing','at_grading','returning'))`);
  const jobIds=db.select({id:careJobs.id}).from(careJobs).where(or(eq(careJobs.requesterId,p.id),eq(careJobs.providerProfileId,p.id)));
  const providerIds=db.select({id:careProviders.id}).from(careProviders).where(eq(careProviders.profileId,p.id));
  const listingIds=db.select({id:listings.id}).from(listings).where(eq(listings.sellerId,p.id));
  const threadIds=db.select({id:threads.id}).from(threads).where(or(eq(threads.a,p.id),eq(threads.b,p.id)));
  // Always resolve dependencies inside the transaction. Preliminary counts can
  // miss a newly committed request, message, review or offer before deletion.
  const dependent=[
   db.delete(reports).where(and(eq(reports.targetType,'post_reply'),inArray(reports.targetId,db.select({id:groupPostReplies.id}).from(groupPostReplies).where(eq(groupPostReplies.profileId,p.id))))),
   ...removeCommunityPosts(db,eq(groupPosts.profileId,p.id)),
   db.delete(groupPostReplies).where(eq(groupPostReplies.profileId,p.id)),
   db.delete(groupPostReactions).where(eq(groupPostReactions.profileId,p.id)),
   db.delete(careReviews).where(inArray(careReviews.jobId,jobIds)),
   db.delete(careEvents).where(inArray(careEvents.jobId,jobIds)),
   db.delete(careReviews).where(inArray(careReviews.providerId,providerIds)),
   db.delete(offers).where(inArray(offers.listingId,listingIds)),
   db.delete(tradeProposals).where(or(eq(tradeProposals.buyerId,p.id),eq(tradeProposals.sellerId,p.id))),
   db.delete(messages).where(inArray(messages.threadId,threadIds))
  ];
  const query=[
   db.delete(careEvents).where(eq(careEvents.actorId,p.id)),
   db.delete(careJobs).where(or(eq(careJobs.requesterId,p.id),eq(careJobs.providerProfileId,p.id))),
   db.delete(careReviews).where(eq(careReviews.authorId,p.id)),
   db.delete(careProviders).where(eq(careProviders.profileId,p.id)),
   db.delete(memberships).where(eq(memberships.profileId,p.id)),
   db.delete(groupPosts).where(eq(groupPosts.profileId,p.id)),
   db.delete(messages).where(eq(messages.profileId,p.id)),
   db.delete(blocks).where(or(eq(blocks.fromId,p.id),eq(blocks.toId,p.id))),
   db.delete(swipes).where(or(eq(swipes.fromId,p.id),eq(swipes.toId,p.id))),
   db.delete(offers).where(eq(offers.buyerId,p.id)),
   db.delete(reports).where(eq(reports.profileId,p.id)),
   db.delete(listings).where(eq(listings.sellerId,p.id)),
   db.delete(threads).where(or(eq(threads.a,p.id),eq(threads.b,p.id))),
   db.update(groups).set({ownerId:null}).where(eq(groups.ownerId,p.id)),
   db.delete(commerceSellers).where(and(eq(commerceSellers.profileId,p.id),eq(commerceSellers.userId,u.userId))),
   db.delete(profiles).where(eq(profiles.id,p.id))
  ];
  try{await db.batch([careSafe.start,...anonymize.checks,...dependent,...anonymize.before,...query,...anonymize.after,careSafe.finish])}
  catch(error){
   if(marketplaceGuardFailed(error)){
    if((await activeCustody()).length)throw new ApiRequestError(custodyError,409);
    await checkMarketplaceDeletion(db,p);
    throw new ApiRequestError('Your marketplace records changed while deleting. Refresh your account and try again.',409);
   }
   throw error;
  }
 }
 const dataSafe=conditionalGuard(db,sql`NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.buyer_user_id = ${u.userId} OR o.seller_user_id = ${u.userId})`);
 try{await db.batch([dataSafe.start,db.delete(collections).where(eq(collections.userId,u.userId)),db.delete(media).where(eq(media.userId,u.userId)),db.delete(commerceSellers).where(and(eq(commerceSellers.userId,u.userId),sql`NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = ${sql.raw('commerce_sellers.profile_id')})`)),dataSafe.finish])}
 catch(error){if(marketplaceGuardFailed(error))throw new ApiRequestError('Your financial records changed while deleting. Contact maliktecks@gmail.com for support.',409);throw error}
 if(env.BUCKET&&assets.length)await env.BUCKET.delete(assets.map(m=>'photos/'+m.id));
 return json({saved:true});
}
if(a.action==='profile'){if(p?.moderated||await isRestricted(db,u.userId))return json({error:'Your account is restricted pending moderation review.'},403);const v=z.object({handle:z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,23}$/),name:text(60),bio:z.string().max(500),tagline:z.string().max(100),location:z.string().max(60),favorite:z.string().max(80),since:z.number().int().min(1930).max(new Date().getFullYear()),color:z.enum(['red','blue','yellow','teal']),featured:z.array(z.string().max(80)).max(6),visible:z.boolean(),dmOpen:z.boolean(),accept:z.boolean().optional()}).parse(a);if(v.accept!==true&&(!p?.rulesAcceptedAt||p.rulesVersion!==previewRulesVersion))return json({error:'Accept the current community rules to create or update your collector profile.'},400);const consent=v.accept===true?{rulesVersion:previewRulesVersion,rulesAcceptedAt:now()}:{rulesVersion:p!.rulesVersion,rulesAcceptedAt:p!.rulesAcceptedAt};const vlt=await ownedVault(db,u.userId);if(v.featured.some(id=>!vlt.books.some(b=>b.id===id)))return json({error:'Only your own books can be featured.'},400);const [occupied]=await db.select().from(profiles).where(eq(profiles.handle,v.handle));if(occupied&&occupied.userId!==u.userId)return json({error:'That collector handle is taken.'},409);const data={...consent,userId:u.userId,handle:v.handle,name:v.name,bio:v.bio,tagline:v.tagline,location:v.location,favorite:v.favorite,since:v.since,color:v.color,featured:JSON.stringify(v.featured),visible:Number(v.visible),dmOpen:Number(v.dmOpen)};if(p)await db.update(profiles).set(data).where(eq(profiles.id,p.id));else await db.insert(profiles).values({...data,id:crypto.randomUUID(),createdAt:now()});return json({saved:true});}
if(!p)return json({error:'Create your free collector profile first.',code:'profile_required'},403);
const endingTrade=action==='trade_terms_decision'&&['decline','cancel'].includes(String(a.decision));
if(!endingTrade&&!['report','block','retract_bid'].includes(action)&&(p.moderated||await isRestricted(db,u.userId)))return json({error:'Your account is restricted pending moderation review.'},403);
if(!endingTrade&&!['report','block'].includes(action)&&(p.rulesVersion!==previewRulesVersion||!p.rulesAcceptedAt))return json({error:'Open your collector profile and accept the current community rules before continuing.'},403);
if(a.action==='join'){
 const v=z.object({action:z.literal('join'),groupId:id,join:z.boolean()}).strict().parse(a);await seedGroups(db);const [g]=await db.select().from(groups).where(eq(groups.id,v.groupId));if(!g)return json({error:'Group not found.'},404);
 if(!v.join&&g.ownerId===p.id)return json({error:'Group owners must keep membership.'},400);
 const guard=conditionalGuard(db,sql`${communityActor(p)} AND EXISTS (SELECT 1 FROM groups g WHERE g.id = ${g.id} AND (g.owner_id IS NULL OR ${communityPerson(sql`g.owner_id`,p)}) AND (${v.join?1:0} = 1 OR g.owner_id IS NULL OR g.owner_id != ${p.id}))`);
 await communityBatch(db,[guard.start,v.join?db.insert(memberships).values({groupId:g.id,profileId:p.id,joinedAt:now()}).onConflictDoNothing():db.delete(memberships).where(and(eq(memberships.groupId,g.id),eq(memberships.profileId,p.id))),guard.finish]);return json({saved:true});
}
if(a.action==='create_group'){
 const v=z.object({action:z.literal('create_group'),name:text(60),description:text(300),color:z.enum(['red','blue','yellow','teal'])}).strict().parse(a);const existing=await db.select().from(groups).where(eq(groups.ownerId,p.id));if(existing.length>=5)return json({error:'You can create up to five groups in this preview.'},429);
 const groupId=crypto.randomUUID(),guard=conditionalGuard(db,sql`${communityActor(p)} AND (SELECT COUNT(*) FROM groups g WHERE g.owner_id = ${p.id}) < 5`),stamp=now();
 await communityBatch(db,[guard.start,db.insert(groups).values({id:groupId,ownerId:p.id,name:v.name,description:v.description,color:v.color,createdAt:stamp}),db.insert(memberships).values({groupId,profileId:p.id,joinedAt:stamp}),guard.finish]);return json({groupId});
}
if(a.action==='post'){
 const v=z.object({action:z.literal('post'),groupId:id,channel:z.enum(['general','showcase','trading']),body:text(1500),kind:z.enum(communityPostKinds).default('discussion'),title:z.string().trim().max(120).default(''),photoId:z.string().uuid().nullable().optional()}).strict().parse(a);
 if(!await joined(db,p.id,v.groupId))return json({error:'Join this group before posting.'},403);
 if(v.photoId){const [asset]=await db.select().from(media).where(and(eq(media.id,v.photoId),eq(media.userId,u.userId)));if(!asset)return json({error:'Attach only a photo uploaded to your own account.'},403)}
 const postId=crypto.randomUUID(),guard=communityWriteGuard(db,p,v.groupId,v.photoId?sql`EXISTS (SELECT 1 FROM media photo WHERE photo.id = ${v.photoId} AND photo.user_id = ${u.userId})`:sql`true`);
 await communityBatch(db,[guard.start,db.insert(groupPosts).values({id:postId,groupId:v.groupId,channel:v.channel,profileId:p.id,body:v.body,kind:v.kind,title:v.title,photoId:v.photoId||null,createdAt:now()}),guard.finish]);return json({saved:true,postId});
}
if(a.action==='post_reply'||a.action==='post_react'){
 const reply=a.action==='post_reply',v=reply?z.object({action:z.literal('post_reply'),postId:id,body:text(1500)}).strict().parse(a):z.object({action:z.literal('post_react'),postId:id,like:z.boolean()}).strict().parse(a);
 const [post]=await db.select().from(groupPosts).where(eq(groupPosts.id,v.postId));if(!post)return json({error:'Conversation not found.'},404);
 if(!await joined(db,p.id,post.groupId))return json({error:'Join this group to participate.'},403);
 const guard=communityWriteGuard(db,p,post.groupId,sql`EXISTS (SELECT 1 FROM group_posts target WHERE target.id = ${post.id} AND target.group_id = ${post.groupId} AND ${communityPerson(sql`target.profile_id`,p)})`);
 if(reply){const replyId=crypto.randomUUID();await communityBatch(db,[guard.start,db.insert(groupPostReplies).values({id:replyId,postId:post.id,profileId:p.id,body:(v as {body:string}).body,createdAt:now()}),guard.finish]);return json({saved:true,replyId})}
 const like=(v as {like:boolean}).like;await communityBatch(db,[guard.start,like?db.insert(groupPostReactions).values({postId:post.id,profileId:p.id,createdAt:now()}).onConflictDoNothing():db.delete(groupPostReactions).where(and(eq(groupPostReactions.postId,post.id),eq(groupPostReactions.profileId,p.id))),guard.finish]);return json({saved:true,postId:post.id,liked:like});
}
if(a.action==='delete_post'){
 const v=z.object({action:z.literal('delete_post'),postId:id}).strict().parse(a),[post]=await db.select().from(groupPosts).where(eq(groupPosts.id,v.postId));if(!post)return json({error:'Post not found.'},404);
 const [g]=await db.select().from(groups).where(eq(groups.id,post.groupId));if(post.profileId!==p.id&&g?.ownerId!==p.id)return json({error:'You cannot delete this post.'},403);
 const guard=communityWriteGuard(db,p,post.groupId,sql`EXISTS (SELECT 1 FROM group_posts target JOIN groups managed ON managed.id = target.group_id WHERE target.id = ${post.id} AND (target.profile_id = ${p.id} OR managed.owner_id = ${p.id}))`);
 await communityBatch(db,[guard.start,...removeCommunityPosts(db,eq(groupPosts.id,post.id)),guard.finish]);return json({saved:true});
}
if(a.action==='delete_post_reply'){
 const v=z.object({action:z.literal('delete_post_reply'),replyId:id}).strict().parse(a),[reply]=await db.select().from(groupPostReplies).where(eq(groupPostReplies.id,v.replyId));if(!reply)return json({error:'Reply not found.'},404);
 const [post]=await db.select().from(groupPosts).where(eq(groupPosts.id,reply.postId)),[g]=post?await db.select().from(groups).where(eq(groups.id,post.groupId)):[];
 if(!post)return json({error:'Conversation not found.'},404);if(reply.profileId!==p.id&&g?.ownerId!==p.id)return json({error:'You cannot delete this reply.'},403);
 const guard=communityWriteGuard(db,p,post.groupId,sql`EXISTS (SELECT 1 FROM group_post_replies reply JOIN group_posts post ON post.id = reply.post_id JOIN groups g ON g.id = post.group_id WHERE reply.id = ${reply.id} AND (reply.profile_id = ${p.id} OR g.owner_id = ${p.id}))`);
 await communityBatch(db,[guard.start,db.delete(reports).where(and(eq(reports.targetType,'post_reply'),eq(reports.targetId,reply.id))),db.delete(groupPostReplies).where(eq(groupPostReplies.id,reply.id)),guard.finish]);return json({saved:true});
}
if(a.action==='start_thread'){const v=z.object({to:id,context:z.string().max(200).optional()}).parse(a);const thread=await beginThread(db,p,v.to,v.context);return json({threadId:thread.id});}
if(a.action==='message'){const v=z.object({threadId:id,body:text(2000)}).parse(a);const [t]=await db.select().from(threads).where(eq(threads.id,v.threadId));if(!t||![t.a,t.b].includes(p.id))return json({error:'Conversation not found.'},404);const [peer]=await db.select().from(profiles).where(eq(profiles.id,t.a===p.id?t.b:t.a));if(!peer?.dmOpen||await blocked(db,t.a,t.b))return json({error:'Messaging is unavailable for this collector.'},403);await db.insert(messages).values({...v,id:crypto.randomUUID(),profileId:p.id,createdAt:now()});return json({saved:true});}
if(a.action==='block'){const v=z.object({to:id}).parse(a);if(v.to===p.id)return json({error:'Invalid collector.'},400);const [target]=await db.select({id:profiles.id}).from(profiles).where(eq(profiles.id,v.to));if(!target)return json({error:'Collector not found.'},404);await db.insert(blocks).values({fromId:p.id,toId:v.to}).onConflictDoNothing();return json({saved:true});}
if(a.action==='listing')return json(await createListing(db,p,a));
if(a.action==='trade_offer')return json(await proposeListingTrade(db,p,a));
if(a.action==='trade_terms_decision')return json(await decideTradeTerms(db,p,a));
if(a.action==='bid')return json(await placeBid(db,p,a));
if(a.action==='retract_bid')return json(await retractBid(db,p,a));
if(a.action==='withdraw_listing'){const v=z.object({listingId:id}).parse(a);const [l]=await db.select().from(listings).where(eq(listings.id,v.listingId));if(!l||l.sellerId!==p.id)return json({error:'Listing not found.'},404);if(l.saleType==='auction'&&l.bidCount>0)return json({error:'Auction previews with accepted proposal history require owner cancellation. Contact maliktecks@gmail.com; no sale or payment was created.'},409);await withdrawListing(db,p,l.id);return json({saved:true});}
if(a.action==='offer'){const v=z.object({listingId:id,amount:z.number().int().min(100).max(100000000),note:z.string().max(500)}).parse(a);const [l]=await db.select().from(listings).where(eq(listings.id,v.listingId));if(!l||l.status!=='active'||l.saleType==='auction'||l.sellerId===p.id)return json({error:'This listing cannot receive your offer.'},400);if(await blocked(db,p.id,l.sellerId))return json({error:'Offer unavailable.'},403);const t=await beginThread(db,p,l.sellerId,l.title);const changed=await db.insert(offers).select(db.select({id:sql<string>`${crypto.randomUUID()}`.as('id'),listingId:listings.id,buyerId:sql<string>`${p.id}`.as('buyer_id'),amount:sql<number>`${v.amount}`.as('amount'),note:sql<string>`${v.note}`.as('note'),status:sql<string>`'pending'`.as('status'),createdAt:sql<string>`${now()}`.as('created_at')}).from(listings).where(and(eq(listings.id,l.id),eq(listings.status,'active'),eq(listings.saleType,'fixed')))).returning({id:offers.id});if(!changed.length)return json({error:'This listing changed. Reload it before making an offer.'},409);return json({saved:true,threadId:t.id});}
if(a.action==='offer_response'){const v=z.object({offerId:id,status:z.enum(['accepted','declined'])}).parse(a);const [o]=await db.select().from(offers).where(eq(offers.id,v.offerId));const [l]=o?await db.select().from(listings).where(eq(listings.id,o.listingId)):[];if(!o||!l||l.sellerId!==p.id||o.status!=='pending'||l.status!=='active'||l.saleType==='auction')return json({error:'Offer not available.'},404);const changed=await db.update(offers).set({status:v.status}).where(and(eq(offers.id,o.id),eq(offers.status,'pending'),inArray(offers.listingId,db.select({id:listings.id}).from(listings).where(and(eq(listings.id,l.id),eq(listings.sellerId,p.id),eq(listings.status,'active'),eq(listings.saleType,'fixed')))))).returning({id:offers.id});if(!changed.length)return json({error:'This offer or listing changed. Reload it before responding.'},409);return json({saved:true,note:'Accepting an offer does not charge the buyer or complete a sale.'});}
if(a.action==='buy'){
 const v=z.object({listingId:id}).parse(a);
 const [l]=await db.select().from(listings).where(eq(listings.id,v.listingId));
 if(!l||l.status!=='active'||l.saleType==='auction'||l.sellerId===p.id)return json({error:'Listing not available for purchase.'},400);
 const [seller]=await db.select().from(profiles).where(eq(profiles.id,l.sellerId));
 if(!seller?.visible||seller.moderated||seller.deletionStartedAt||await isRestricted(db,seller.userId)||await blocked(db,p.id,l.sellerId))return json({error:'Listing not available for purchase.'},404);
 return json({error:'Checkout is not connected. No payment or order was created.',code:'payment_setup_required'},503);
}
if(a.action==='swipe'){const v=z.object({to:id,giveId:id,getId:id,direction:z.enum(['like','pass'])}).parse(a);const [target]=await db.select().from(profiles).where(eq(profiles.id,v.to));if(!target||!target.visible||!target.dmOpen||!p.visible||!p.dmOpen||target.id===p.id||await blocked(db,p.id,target.id))return json({error:'Collector unavailable.'},400);const mine=await ownedVault(db,p.userId),theirs=await ownedVault(db,target.userId);const give=mine.books.find(b=>b.id===v.giveId),get=theirs.books.find(b=>b.id===v.getId);if(!give||!get||!mine.tradeBookIds.includes(give.id)||!theirs.tradeBookIds.includes(get.id))return json({error:'This trade pile changed. Refresh discovery.'},409);const gi=bookIssue(give),wi=bookIssue(get);if(!gi||!wi||gi.id===wi.id||!mine.wants.includes(wi.id)||!theirs.wants.includes(gi.id))return json({error:'These books do not form a reciprocal trade.'},400);const pair=[p.id+':'+give.id,target.id+':'+get.id].sort().join('|');await db.insert(swipes).values({id:crypto.randomUUID(),pair,fromId:p.id,toId:target.id,giveId:give.id,getId:get.id,direction:v.direction,createdAt:now()}).onConflictDoUpdate({target:[swipes.fromId,swipes.pair],set:{direction:v.direction,createdAt:now()}});const reciprocal=await db.select().from(swipes).where(and(eq(swipes.fromId,target.id),eq(swipes.pair,pair),eq(swipes.direction,'like')));if(v.direction==='like'&&reciprocal.length){const t=await beginThread(db,p,target.id,give.title+' '+give.issue+' ↔ '+get.title+' '+get.issue);return json({matched:true,threadId:t.id});}return json({matched:false});}
if(a.action==='report'){const v=z.object({targetType:z.enum(['post','post_reply','profile','listing','message','care_review','care_provider']),targetId:id,reason:text(500)}).parse(a);if(!await canReport(db,p,v.targetType,v.targetId))return json({error:'This content is not available for you to report.'},404);await db.insert(reports).values({...v,id:crypto.randomUUID(),profileId:p.id,createdAt:now()});return json({saved:true});}
return json({error:'Unknown action.'},400);
}catch(e){if(e instanceof ApiRequestError)return json({error:e.message},e.status);if(e instanceof z.ZodError)return json({error:'Please check the fields and try again.'},400);if(e instanceof Error&&['You cannot message yourself.','This collector is not accepting messages.'].includes(e.message))return json({error:e.message},403);return json({error:'Could not save this change. Please retry.'},500)}}
