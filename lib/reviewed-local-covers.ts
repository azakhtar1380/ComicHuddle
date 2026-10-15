import type {Issue} from './catalog';
// Exact native GCD issues checked against the retained bibliography on 2026-10-15.
// These are the same six reviewed US public-domain files already served by this app.
// This is not permission for modern publisher art or a title/number-based fallback.
const native=new Map([[1400,['12',1941]],[2506,['21',1942]],[3244,['27',1943]],[5068,['42',1946]],[6567,['53',1948]],[6841,['55',1948]]] as const);
export function reviewedLocalCover(issue:Issue):Issue{
 const match=issue.gcdId?native.get(issue.gcdId as 1400):undefined;
 if(!match||issue.id!==4000000000+Number(issue.gcdId)||issue.title!=='Planet Comics'||issue.publisher!=='Fiction House'||issue.number!==match[0]||issue.year!==match[1]||/facsimile|reprint/i.test(issue.variant))return issue;
 return {...issue,cover:'/covers/planet-'+match[0]+'.jpg',coverSource:'https://commons.wikimedia.org/wiki/File:Planet_Comics_'+match[0]+'.jpg',coverCredit:'Wikimedia Commons · reviewed public-domain US edition · original publisher: Fiction House'};
}
