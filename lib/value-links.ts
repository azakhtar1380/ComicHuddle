// Ordinary outbound links. No GoCollect API, pricing import or affiliation; no CGC integration.
// Destinations verified 2026-11-15:
//  - https://gocollect.com/comics              GoCollect comic price guide (landing page)
//  - https://gocollect.com/search?q=<text>     GoCollect search results (exact issue listed first, variants follow)
//  - https://www.cgccomics.com/submit/how-to-submit/  CGC's official "How to Submit to CGC" page
//    (links on to account sign-up, tiers & fees and the submission form)
export const goCollectComicGuideUrl='https://gocollect.com/comics';
export const cgcSubmitUrl='https://www.cgccomics.com/submit/how-to-submit/';

/** Search text for one issue: series without a trailing "(1963)" style year, plus the issue number. */
export function goCollectSearchText(issue:{title:string;number:string}){
 const title=issue.title.replace(/\s*\(\d{4}(?:\s+series)?\)\s*$/i,'').replace(/^series metadata pending.*$/i,'').trim();
 const number=issue.number.replace(/^#/,'').trim();
 return [title,number].filter(Boolean).join(' ').slice(0,120);
}
/** The one GoCollect link on the issue detail: a GoCollect search for this series and issue number. */
export function goCollectIssueUrl(issue:{title:string;number:string}){
 const text=goCollectSearchText(issue);
 return text?'https://gocollect.com/search?q='+encodeURIComponent(text):goCollectComicGuideUrl;
}
/** Plain-text research reference (kept for older callers and checks). */
export function goCollectResearchText(issue:{title:string;number:string;year:number;variant:string}){return issue.title+' #'+issue.number+' ('+issue.year+') · '+issue.variant;}
