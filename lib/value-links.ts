// Ordinary outbound research link. No GoCollect API, pricing import or affiliation.
export const goCollectComicGuideUrl='https://gocollect.com/comics';
const verifiedGoCollectPages:Record<string,string>={
 'amazing spider man|300|1988':'amazing-spider-man-300',
 'uncanny x men|266|1990':'uncanny-x-men-266',
 'marvel super heroes secret wars|8|1984':'marvel-super-heroes-secret-wars-8',
 'incredible hulk|181|1974':'incredible-hulk-181',
 'action comics|1|1938':'action-comics-1-1',
};
export function goCollectIssueUrl(issue:{title:string;number:string;year:number;variant:string;metronId?:number}){
 if(issue.metronId!==undefined||issue.variant!=='Original issue · printing to be confirmed')return null;
 if(/newsstand|mexic|facsimile|reprint|later printing|second printing|variant cover/i.test(issue.variant))return null;
 const title=issue.title.replace(/\s*\(\d{4}\)\s*$/,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const slug=verifiedGoCollectPages[title+'|'+issue.number+'|'+issue.year];
 return slug?'https://gocollect.com/comic/'+slug:null;
}
export function goCollectResearchText(issue:{title:string;number:string;year:number;variant:string}){return issue.title+' #'+issue.number+' ('+issue.year+') · '+issue.variant;}
