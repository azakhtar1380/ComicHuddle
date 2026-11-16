// Verified checkmark for individual collectors (migration 054). Server-only.
// Flow: the collector asks from the Account panel ("Get verified") → pending → ComicHuddle contacts them to
// confirm they're a real person → an admin turns the check on by hand. Businesses keep lib/business-profile.ts.
import {getPool} from '../db/postgres';
import {businessSummaries} from './business-profile';
import type {VerificationStatus} from './business-profile';

export type VerifiedKind='person'|'business';
export type PersonVerification={status:VerificationStatus;requestedAt:string|null;verifiedAt:string|null};
const iso=(d:Date|null)=>d?new Date(d).toISOString():null;

/** profileId → 'business' (verified business) | 'person' (verified collector). Unverified profiles are absent. */
export async function verifiedKinds(profileIds:readonly string[]):Promise<Map<string,VerifiedKind>>{
 const ids=[...new Set(profileIds.filter(Boolean))],out=new Map<string,VerifiedKind>();
 if(!ids.length)return out;
 try{for(const row of (await getPool().query<{profile_id:string}>("SELECT profile_id FROM ch_web.person_verifications WHERE status='verified' AND profile_id = ANY($1::text[])",[ids])).rows)out.set(row.profile_id,'person')}catch{/* not migrated */}
 const biz=await businessSummaries(ids).catch(()=>new Map());
 for(const [id,summary] of biz)if(summary.isBusiness&&summary.verified)out.set(id,'business');
 return out;
}
export async function verifiedKind(profileId:string|null|undefined):Promise<VerifiedKind|null>{return profileId?(await verifiedKinds([profileId])).get(profileId)||null:null}

export async function personVerification(profileId:string):Promise<PersonVerification>{
 try{const row=(await getPool().query<{status:VerificationStatus;requested_at:Date|null;verified_at:Date|null}>('SELECT status,requested_at,verified_at FROM ch_web.person_verifications WHERE profile_id=$1',[profileId])).rows[0];
  return row?{status:row.status,requestedAt:iso(row.requested_at),verifiedAt:iso(row.verified_at)}:{status:'unverified',requestedAt:null,verifiedAt:null}}
 catch{return {status:'unverified',requestedAt:null,verifiedAt:null}}
}
/** The collector asks to be verified. Business accounts use the business flow instead. */
export async function requestPersonVerification(profile:{id:string;userId:string},contactNote:string){
 const pool=getPool();
 const current=await personVerification(profile.id);
 if(current.status==='verified'||current.status==='pending')return current;
 await pool.query(`INSERT INTO ch_web.person_verifications(profile_id,user_id,status,contact_note,requested_at,status_changed_at,status_changed_by,updated_at) VALUES($1,$2,'pending',$3,now(),now(),$2,now())
  ON CONFLICT(profile_id) DO UPDATE SET status='pending',contact_note=EXCLUDED.contact_note,requested_at=now(),status_changed_at=now(),status_changed_by=EXCLUDED.user_id,updated_at=now()`,[profile.id,profile.userId,contactNote.slice(0,500)]);
 await pool.query("INSERT INTO ch_web.business_verification_events(id,profile_id,action,status,source,actor_user_id,note) VALUES($1,$2,'person_requested','pending','collector',$3,$4)",[crypto.randomUUID(),profile.id,profile.userId,contactNote.slice(0,500)]);
 return personVerification(profile.id);
}
/** Admin turns a collector's check on or off by hand. */
export async function setPersonVerified(adminUserId:string,profileId:string,verified:boolean,note:string){
 const pool=getPool();
 const before=(await pool.query<{status:VerificationStatus;user_id:string}>('SELECT status,user_id FROM ch_web.person_verifications WHERE profile_id=$1',[profileId])).rows[0];
 if(!before)throw Object.assign(new Error('That collector hasn’t asked to be verified.'),{status:404});
 const status:VerificationStatus=verified?'verified':before.status==='verified'?'revoked':'unverified';
 await pool.query(`UPDATE ch_web.person_verifications SET status=$2,admin_note=$3,verified_at=CASE WHEN $4 THEN now() ELSE verified_at END,verified_by=CASE WHEN $4 THEN $5 ELSE verified_by END,status_changed_at=now(),status_changed_by=$5,updated_at=now() WHERE profile_id=$1`,[profileId,status,note.slice(0,500),verified,adminUserId]);
 await pool.query("INSERT INTO ch_web.business_verification_events(id,profile_id,action,status,source,actor_user_id,note) VALUES($1,$2,$3,$4,'admin_manual',$5,$6)",[crypto.randomUUID(),profileId,verified?'person_granted':'person_removed',status,adminUserId,note.slice(0,500)]);
 return {userId:before.user_id,status,changed:status!==before.status};
}
export type AdminPersonRow={profileId:string;handle:string;name:string;status:VerificationStatus;contactNote:string;requestedAt:string|null;verifiedAt:string|null};
export async function listPersonVerifications(status:VerificationStatus|'all'='pending'):Promise<AdminPersonRow[]>{
 try{return (await getPool().query<{profile_id:string;handle:string;name:string;status:VerificationStatus;contact_note:string;requested_at:Date|null;verified_at:Date|null}>(
  `SELECT v.profile_id,p.handle,p.name,v.status,v.contact_note,v.requested_at,v.verified_at FROM ch_web.person_verifications v JOIN ch_web.profiles p ON p.id=v.profile_id WHERE ($1::text IS NULL OR v.status=$1) ORDER BY v.requested_at DESC NULLS LAST LIMIT 200`,[status==='all'?null:status])).rows
  .map(r=>({profileId:r.profile_id,handle:r.handle,name:r.name,status:r.status,contactNote:r.contact_note,requestedAt:iso(r.requested_at),verifiedAt:iso(r.verified_at)}))}catch{return []}
}
