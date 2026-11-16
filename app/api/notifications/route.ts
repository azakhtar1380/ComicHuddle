// In-app notifications (migration 036, lib/notifications.ts). Signed-in only; every read and write is
// scoped to the caller's own account id. GET ?limit=1..50 → {items, unread}. POST {ids?:string[]} marks
// those (or all) as read.
import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {getDb} from '../../../db';
import {ApiRequestError,enforceWriteLimits,privateJson,readObject} from '../../../lib/api-security';
import {listNotifications,markNotificationsRead,payoutSetupReminder} from '../../../lib/notifications';

function fail(error:unknown){
 if(error instanceof ApiRequestError)return privateJson({error:error.message},error.status);
 if(error instanceof z.ZodError)return privateJson({error:'Invalid request.'},400);
 return privateJson({error:'Notifications are unavailable right now.'},500);
}
export async function GET(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to see notifications.',items:[],unread:0},401);
 const raw=new URL(req.url).searchParams.get('limit'),limit=raw&&/^\d{1,2}$/.test(raw)?Math.min(Math.max(Number(raw),1),50):30;
 const [list,reminder]=await Promise.all([listNotifications(user.userId,limit),payoutSetupReminder(user.userId)]);
 // The payment-setup reminder is pinned on top and counts as unread until onboarding is done.
 return privateJson(reminder?{items:[reminder,...list.items].slice(0,limit),unread:list.unread+1}:list);
}catch(error){return fail(error)}}

const markSchema=z.object({action:z.literal('mark_read').optional(),ids:z.array(z.string().uuid()).min(1).max(100).optional()}).strict();
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return privateJson({error:'Sign in to continue.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return privateJson({error:'Request origin rejected.'},403);
 const input=markSchema.parse(await readObject(req,8000));
 const limited=await enforceWriteLimits(getDb(),user.userId,'notifications:mark_read',60);if(limited)return limited;
 await markNotificationsRead(user.userId,input.ids);
 return privateJson({saved:true,...await listNotifications(user.userId,1).then(r=>({unread:r.unread}))});
}catch(error){return fail(error)}}
