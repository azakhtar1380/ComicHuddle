// "Add to collection" from a product card opens the shared comic detail card with its collection dialog.
// The intent is a one-shot hand-off: in-app callers set it before opening the card; links carry
// `?section=Directory&issue=<id>&collect=1`, captured when the bundle loads (before the hub rewrites the URL).
let pending:number|null=typeof window==='undefined'||typeof window.location?.search!=='string'?null:(()=>{
 const params=new URLSearchParams(window.location.search),id=Number(params.get('issue'));
 return params.get('collect')==='1'&&params.has('issue')&&Number.isSafeInteger(id)&&id>=0?id:null;
})();

/** Ask the next comic detail card for `issueId` to open its "Add to collection" dialog. */
export function requestCollectOnOpen(issueId:number){pending=issueId}
/** True once, for the card whose issue matches the pending request. */
export function takeCollectIntent(issueId:number){if(pending!==issueId)return false;pending=null;return true}
/** Link that opens the detail card for an issue with the collection dialog ready. */
export const collectHref=(issueId:number)=>'/?'+new URLSearchParams({section:'Directory',issue:String(issueId),collect:'1'});
