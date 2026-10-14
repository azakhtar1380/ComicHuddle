import {z} from 'zod';
import {catalog,grades} from './catalog';
const https=z.string().url().max(1000).refine(s=>{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password},'A public HTTPS source URL is required.');
export const marketRowSchema=z.object({
 issueId:z.number().int().min(0).max(catalog.length-1),mode:z.enum(['Raw','CGC']),grade:z.string().refine(s=>grades.includes(s)),label:z.enum(['Raw','Universal','Signature Series','Qualified','Restored','Conserved']),printing:z.enum(['First printing','Later printing']),
 fmv:z.number().finite().positive().max(100000000),low:z.number().finite().nonnegative(),high:z.number().finite().positive().max(100000000),sales:z.number().int().min(1).max(10000000),windowDays:z.number().int().min(1).max(366),updatedAt:z.string().datetime().refine(s=>Date.parse(s)<=Date.now(),'Future estimates are not allowed.'),sourceName:z.string().trim().min(2).max(100),sourceUrl:https
}).strict().refine(v=>v.low<=v.fmv&&v.fmv<=v.high,'FMV must be within its reported range.').refine(v=>(v.mode==='Raw')===(v.label==='Raw'),'Raw values must use the Raw label.');
export const marketImportSchema=z.object({currency:z.literal('USD'),rightsConfirmed:z.literal(true),licenseReference:z.string().trim().min(5).max(300),rightsExpiresAt:z.string().datetime().refine(s=>Date.parse(s)>Date.now(),'Redistribution permission must be active.'),rows:z.array(marketRowSchema).min(1).max(100)}).strict();
export function marketKey(v:{issueId:number;mode:string;grade:string;label:string;printing:string}){return [v.issueId,v.mode,v.grade,v.label,v.printing].join('|')}
export function freshValue(updatedAt:string){const t=Date.parse(updatedAt);return Number.isFinite(t)&&t<=Date.now()&&Date.now()-t<=30*86400000}
