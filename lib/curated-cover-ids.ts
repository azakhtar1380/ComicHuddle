/** Curated key issues (lib/catalog.ts index ids) → exact GCD issue ids, so they share the
 * catalog cover pipeline. Matched once by series name + number + cover year + publisher
 * against the GCD tables; ambiguous or wrong-volume matches are left out on purpose. */
export const CURATED_GCD_IDS:Readonly<Record<number,number>>={0:44451,1:44906,2:276819,3:48391,5:19911,6:44575,7:44703,8:48348,9:48479,10:27934,11:17099,12:49289,14:260204,15:51236,16:293,17:442,18:41815,21:36689,23:53568,24:1400,25:2506,26:3244,27:5068,28:6567,29:6841,30:16556,31:17100,32:17568,33:17896,34:245469,35:724,36:17575,37:16935,38:17043,39:560,40:878,41:18338,42:754};
/** Catalog id used for cover lookups: curated ids map to 4000000000 + GCD id. */
export function coverLookupId(issueId:number|null|undefined):number|null{
 if(issueId===undefined||issueId===null)return null;
 if(issueId>=4000000000)return issueId;
 const gcd=CURATED_GCD_IDS[issueId];return gcd?4000000000+gcd:null;
}
