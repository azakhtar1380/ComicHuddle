// Selected factual prices reported by CGC. These are dated individual sales, never FMV.
export type ReportedSale={issueId:number;grade:string;label:string;date:string;dateEnd?:string;amount:number;venue:string;source:string;note?:string;buyerPremium?:boolean};
const ebay='https://www.cgcgrading.com/news/articles/ebay-sales-2025-5QJYjTdBEsTOSqXBLgOaLt/';
export const reportedSales:ReportedSale[]=[
 {issueId:11,grade:'5.0',label:'Label not specified',date:'2025-05-04',amount:45300,venue:'eBay',source:ebay},
 {issueId:30,grade:'4.5',label:'Label not specified',date:'2025-03-20',amount:17151,venue:'eBay',source:ebay},
 {issueId:30,grade:'3.5',label:'Label not specified',date:'2025-04-14',amount:11900,venue:'eBay',source:ebay},
 {issueId:31,grade:'6.5',label:'Signature Series',date:'2025-04-07',amount:17100,venue:'eBay',source:ebay,note:'Signed by Stan Lee, Larry Lieber and Joe Sinnott.'},
 {issueId:32,grade:'5.0',label:'Label not specified',date:'2025-02-18',amount:12000,venue:'eBay',source:ebay},
 {issueId:32,grade:'4.5',label:'Label not specified',date:'2025-03-16',amount:11988,venue:'eBay',source:ebay},
 {issueId:32,grade:'4.0',label:'Label not specified',date:'2025-03-20',amount:10788,venue:'eBay',source:ebay},
 {issueId:33,grade:'5.0',label:'Label not specified',date:'2025-03-16',amount:10656,venue:'eBay',source:ebay},
 {issueId:34,grade:'8.0',label:'Signature Series',date:'2025-03-31',amount:10139,venue:'eBay',source:ebay,note:'Signed by Kevin Eastman.'},
 {issueId:10,grade:'9.8',label:'Label not specified',date:'2025-04-21',amount:50969,venue:'ComicLink',source:'https://www.cgcgrading.com/news/articles/comiclink-hulk-wolverine-7cUbVH2XEU09m0twuRknsV/'}
];
const heritage='https://www.cgcgrading.com/news/articles/action-comics-heritage-million-6wvuW2iyGVLNsLh4NXmCZJ/';
const connect='https://www.cgcgrading.com/news/articles/action-comics-superman-rocket-copy-ir7uN6gTVg63QTQsmzxrD/';
// The source gives a three-day auction window, not individual lot dates.
const july={date:'2026-07-09',dateEnd:'2026-07-11',venue:'Heritage',source:heritage,buyerPremium:true,label:'Label not specified'};
const june={date:'2026-06-22',venue:'ComicConnect',source:connect,label:'Label not specified'};
reportedSales.push(
 {...july,issueId:16,grade:'4.5',amount:1525000},
 {...july,issueId:16,grade:'6.5',label:'Restored',amount:427000},
 {...july,issueId:11,grade:'8.0',amount:237900},
 {...july,issueId:30,grade:'9.0',amount:231800},
 {...july,issueId:38,grade:'9.4',amount:122000},
 {...july,issueId:36,grade:'9.4',amount:118950},
 {...july,issueId:31,grade:'9.0',amount:91500},
 {...july,issueId:37,grade:'8.0',amount:91500},
 {...july,issueId:39,grade:'5.5',amount:79300},
 {...july,issueId:40,grade:'1.8',label:'Signature Series',amount:73200,note:'Signed by Sheldon Moldoff.'},
 {...july,issueId:10,grade:'9.8',amount:53680},
 {...july,issueId:36,grade:'8.5',amount:53680},
 {...june,issueId:16,grade:'6.0',amount:2760000,note:'The individual “Rocket Copy.”'},
 {...june,issueId:35,grade:'6.0',amount:471500},
 {...june,issueId:11,grade:'8.0',amount:211600},
 {...june,issueId:30,grade:'9.0',amount:208150},
 {...june,issueId:41,grade:'9.6',amount:115000},
 {...june,issueId:42,grade:'5.0',amount:45232},
 {...june,issueId:37,grade:'6.0',amount:29325},
 {...june,issueId:32,grade:'7.0',amount:24150}
);
reportedSales.sort((a,b)=>b.date.localeCompare(a.date));
export function saleDate(s:ReportedSale){return s.dateEnd?`${s.date} – ${s.dateEnd}`:s.date}
export function latestSale(issueId:number){return reportedSales.find(s=>s.issueId===issueId)}
