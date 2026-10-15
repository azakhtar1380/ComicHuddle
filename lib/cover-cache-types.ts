export type CoverStatus='PENDING'|'PROCESSING'|'CACHED'|'NOT_FOUND'|'BLOCKED'|'RATE_LIMITED'|'FAILED'|'DISABLED';
export type CoverResolution={issueId:number;status:CoverStatus;url:string|null;srcSet?:string;attribution:string;sourceUrl?:string;message:string;updatedAt?:string};
export const coverStatusMessage=(status:CoverStatus)=>status==='NOT_FOUND'?'Cover scan unavailable':status==='PENDING'||status==='PROCESSING'?'Resolving reference cover…':'Cover temporarily unavailable';
