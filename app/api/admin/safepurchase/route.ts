// Admin-only SafePurchase dashboard API. Every request checks admin on the server (lib/admin.ts requireAdmin).
// Order changes go through the existing commerce functions (lib/commerce.ts), which re-check operator access
// and run the protection policy; this route adds notes/photos, the audit log and buyer/seller notifications.
import {z} from 'zod';
import {and,eq,inArray} from 'drizzle-orm';
import {env} from '../../../../lib/runtime-env';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {getDb} from '../../../../db';
import {media} from '../../../../db/schema';
import {AdminRequiredError,isFounder,requireAdmin} from '../../../../lib/admin';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../../lib/api-security';
import {adminAuditReady,listAdminAudit,logAdminAction} from '../../../../lib/admin-audit';
import {commerceError,commerceInspection,commerceOwnerRefund,commerceOwnerRelease,type StripeSandboxEnv} from '../../../../lib/commerce';
import {addOrderUpdate,adminSafePurchaseOrder,adminSafePurchaseOrders,notifyParties,safePurchaseRow} from '../../../../lib/safepurchase';
import {SAFEPURCHASE_STEPS,stepLabel,type SafePurchaseStep} from '../../../../lib/safepurchase-steps';

export const dynamic='force-dynamic';
const environment=()=>env as unknown as StripeSandboxEnv;
const id=z.string().trim().min(1).max(100);
const uuid=z.string().uuid();
const text=(max:number)=>z.string().trim().max(max).refine(s=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'Remove control characters.');
const carrier=z.enum(['USPS','UPS','FedEx','DHL']);
const tracking=z.string().trim().min(6).max(60).regex(/^[A-Za-z0-9 -]+$/,'Use letters, numbers, spaces or dashes.');
const extras={note:text(1000).default(''),photoIds:z.array(uuid).max(8).default([])};
const actionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('receive'),orderId:id,...extras}).strict(),
 z.object({action:z.literal('check'),orderId:id,result:z.enum(['passed','failed','partial']),reasons:z.array(text(200).pipe(z.string().min(1))).max(20).default([]),failedItems:z.number().int().min(0).max(1000).default(0),requestId:uuid,...extras}).strict(),
 z.object({action:z.literal('ship_to_buyer'),orderId:id,carrier,trackingNumber:tracking,...extras}).strict(),
 z.object({action:z.literal('handoff'),orderId:id,code:z.string().trim().regex(/^\d{6}$/,'Enter the buyer’s 6-digit pickup code.'),...extras}).strict(),
 z.object({action:z.literal('refund'),orderId:id,requestId:uuid,approveIssue:z.literal(true).optional(),...extras}).strict(),
 z.object({action:z.literal('return_shipped'),orderId:id,carrier,trackingNumber:tracking,...extras}).strict(),
 z.object({action:z.literal('note'),orderId:id,step:z.enum(SAFEPURCHASE_STEPS),internal:z.boolean(),note:text(1000).pipe(z.string().min(1,'Write a note.')),photoIds:z.array(uuid).max(8).default([])}).strict(),
 z.object({action:z.literal('release'),orderId:id,requestId:uuid}).strict(),
]);
type Action=z.infer<typeof actionSchema>;
const budgets:Record<Action['action'],number>={receive:30,check:30,ship_to_buyer:30,handoff:5,refund:10,return_shipped:30,note:60,release:10};

function failure(error:unknown){
 if(error instanceof AdminRequiredError)return privateJson({error:error.message},403);
 if(error instanceof z.ZodError)return privateJson({error:error.issues[0]?.message||'Please check the fields and try again.'},400);
 return commerceError(error);
}
async function admin(){
 const user=await getChatGPTUser();if(!user)throw new ApiRequestError('Sign in to continue.',401);
 return requireAdmin(user);
}

export async function GET(req:Request){try{
 const user=await admin(),url=new URL(req.url),orderId=url.searchParams.get('order');
 if(orderId){
  const detail=await adminSafePurchaseOrder(environment(),user.userId,orderId.slice(0,100));
  const audit=await listAdminAudit({targetType:'order',targetId:detail.order.orderId,limit:50});
  return privateJson({...detail,audit:audit.entries,auditReady:audit.ready});
 }
 const offset=Number(url.searchParams.get('offset')||0);
 return privateJson({...await adminSafePurchaseOrders(environment(),{adminUserId:user.userId,step:url.searchParams.get('step')||'all',q:url.searchParams.get('q')||'',offset:Number.isSafeInteger(offset)?offset:0}),auditReady:await adminAuditReady()});
}catch(error){return failure(error)}}

const notices:Record<string,{title:string;body:string}>={
 receive:{title:'SafePurchase: comic received',body:'It’s at ComicHuddle now. We check it next.'},
 passed:{title:'SafePurchase: check passed',body:'Right book, condition as described. It goes to the buyer next.'},
 failed:{title:'SafePurchase: check failed',body:'The buyer is refunded and the comic goes back to the seller.'},
 partial:{title:'SafePurchase: part of the collection failed',body:'The buyer chooses a pro-rated or a full refund in Orders.'},
 ship_to_buyer:{title:'SafePurchase: on its way to the buyer',body:'Insured, signature required.'},
 handoff:{title:'SafePurchase: picked up',body:'The buyer picked up the order at ComicHuddle.'},
 refund:{title:'SafePurchase: refund started',body:'A refund to the buyer was started.'},
 return_shipped:{title:'SafePurchase: comic returned to the seller',body:'The comic is on its way back to the seller.'},
 release:{title:'SafePurchase: seller payout started',body:'The seller payout was started.'},
};

export async function POST(req:Request){
 let user:{userId:string;email?:string|null}|null=null,input:Action|null=null;
 try{
  user=await admin();
  if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
  const raw=await readObject(req,20000);input=actionSchema.parse(raw);
  const db=getDb(),limited=await enforceWriteLimits(db,user.userId,'admin:safepurchase:'+input.action,budgets[input.action]);if(limited)return limited;
  // Every admin action is logged. Refuse the action when it cannot be logged (migration 040 not applied).
  if(!await adminAuditReady())return privateJson({error:'Admin actions need database migration 040 (audit log). Ask the owner to apply it.'},503);
  const row=await safePurchaseRow(input.orderId);
  // A non-founder admin never acts on an order they bought or sold (also enforced inside lib/commerce.ts).
  if(!isFounder(user)&&(row.buyerUserId===user.userId||row.sellerUserId===user.userId))throw new ApiRequestError('You can’t manage your own order. Ask another admin.',403);
  const photoIds='photoIds' in input?input.photoIds:[];
  if(photoIds.length){
   const owned=await db.select({id:media.id}).from(media).where(and(inArray(media.id,photoIds),eq(media.userId,user.userId)));
   if(owned.length!==new Set(photoIds).size)throw new ApiRequestError('Attach photos you uploaded yourself.',400);
  }
  const env=environment();let result:unknown=null,step:SafePurchaseStep|null=null,notice:{title:string;body:string}|null=null;
  let update:{kind:'note'|'tracking'|'return_shipped'|'internal_note'|'step';carrier?:string;trackingNumber?:string;internal:boolean}|null=null;
  switch(input.action){
   case 'receive':result=await commerceInspection(db,user.userId,{action:'inspection',orderId:input.orderId,step:'receive'},env);step='received';notice=notices.receive;update={kind:'step',internal:false};break;
   case 'check':result=await commerceInspection(db,user.userId,{action:'inspection',orderId:input.orderId,step:'decide',result:input.result,reasons:input.reasons,failedItems:input.failedItems,requestId:input.requestId},env);step='checked';notice=notices[input.result];update={kind:'step',internal:false};break;
   case 'ship_to_buyer':result=await commerceInspection(db,user.userId,{action:'inspection',orderId:input.orderId,step:'ship',carrier:input.carrier,trackingNumber:input.trackingNumber},env);step='shipped_to_buyer';notice={...notices.ship_to_buyer,body:notices.ship_to_buyer.body+' Tracking: '+input.carrier+' '+input.trackingNumber+'.'};update={kind:'tracking',carrier:input.carrier,trackingNumber:input.trackingNumber,internal:false};break;
   case 'handoff':result=await commerceInspection(db,user.userId,{action:'inspection',orderId:input.orderId,step:'handoff',code:input.code},env);step='delivered';notice=notices.handoff;update={kind:'step',internal:false};break;
   case 'refund':result=await commerceOwnerRefund(db,user.userId,{action:'owner_refund',orderId:input.orderId,requestId:input.requestId,...(input.approveIssue?{approveIssue:true as const}:{})},env);step='checked';notice=notices.refund;update={kind:'internal_note',internal:true};break;
   case 'return_shipped':{
    const state=JSON.parse(row.state) as {inspection?:{result?:string;buyerChoice?:string}};
    if(!(state.inspection?.result==='failed'||state.inspection?.result==='partial'&&state.inspection.buyerChoice==='full_refund'))throw new ApiRequestError('A return to the seller applies only after a failed check.',409);
    step='checked';notice={...notices.return_shipped,body:notices.return_shipped.body+' Tracking: '+input.carrier+' '+input.trackingNumber+'.'};update={kind:'return_shipped',carrier:input.carrier,trackingNumber:input.trackingNumber,internal:false};break;
   }
   case 'note':step=input.step;notice=input.internal?null:{title:'SafePurchase update: '+stepLabel(input.step),body:input.note.slice(0,200)};update={kind:input.internal?'internal_note':'note',internal:input.internal};break;
   case 'release':result=await commerceOwnerRelease(db,user.userId,{action:'owner_release',orderId:input.orderId,requestId:input.requestId},env);step='done';notice=notices.release;break;
  }
  const note='note' in input?input.note:'';
  let updateId:string|null=null;
  // Step actions always leave a timeline entry when they carry a note, photos or tracking; plain notes always do.
  if(update&&step&&(note||photoIds.length||update.trackingNumber||input.action==='note'||input.action==='return_shipped'))
   updateId=await addOrderUpdate({orderId:row.id,step,kind:update.kind,note,carrier:update.carrier,trackingNumber:update.trackingNumber,photoIds,internal:update.internal,createdBy:user.userId});
  await logAdminAction({admin:user,action:'safepurchase.'+input.action,targetType:'order',targetId:row.id,detail:{ok:true,step,...(input.action==='check'?{result:input.result,reasons:input.reasons}:{}),...('trackingNumber' in input?{carrier:input.carrier,trackingNumber:input.trackingNumber}:{}),...(input.action==='note'?{internal:input.internal}:{}),...(note?{note:note.slice(0,300)}:{}),photos:photoIds.length,updateId}});
  if(notice)await notifyParties(row,notice.title,notice.body);
  return privateJson({ok:true,result,updateId,detail:await adminSafePurchaseOrder(env,user.userId,row.id)});
 }catch(error){
  // Rejected attempts by a signed-in admin are logged too (who, what, when, why).
  if(user&&input)await logAdminAction({admin:user,action:'safepurchase.'+input.action,targetType:'order',targetId:input.orderId,detail:{ok:false,error:error instanceof Error?error.message.slice(0,200):'error'}});
  return failure(error);
 }
}
