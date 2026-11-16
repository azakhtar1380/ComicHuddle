export type CoverStatus='PENDING'|'PROCESSING'|'CACHED'|'NOT_FOUND'|'BLOCKED'|'RATE_LIMITED'|'FAILED'|'DISABLED';
export type CoverResolution={issueId:number;status:CoverStatus;url:string|null;srcSet?:string;attribution:string;sourceUrl?:string;message:string;updatedAt?:string};
// Community fallbacks (lib/community-covers.ts). Client-safe: the cover UI keys its report action on these.
export const SELLER_PHOTO_CREDIT='Photo from a ComicHuddle seller';
export const COMMUNITY_COVER_CREDIT='Cover photo shared by a collector';
export const communityPhotoUrl=(mediaId:string)=>'/api/media?id='+mediaId+'&size=thumbnail';
/** The media id behind a fallback cover URL built by communityPhotoUrl, else null. */
export function coverMediaId(url:string|null|undefined){const match=/^\/api\/media\?id=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:&size=thumbnail)?$/.exec(url||'');return match?match[1]:null}
export const coverStatusMessage=(status:CoverStatus)=>status==='NOT_FOUND'?'Cover scan unavailable':status==='PENDING'||status==='PROCESSING'?'Resolving reference cover…':status==='DISABLED'?'No cover photo yet':status==='BLOCKED'?'Cover source unavailable':status==='RATE_LIMITED'?'Cover retrieval delayed':'Cover temporarily unavailable';
