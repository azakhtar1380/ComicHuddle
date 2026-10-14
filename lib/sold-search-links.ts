/** Human-driven research link. Does not scrape eBay or represent asking prices as FMV. */
export function ebaySoldSearch(title:string,number:string){return 'https://www.ebay.com/sch/i.html?'+new URLSearchParams({_nkw:`${title} ${number} comic`,LH_Complete:'1',LH_Sold:'1'}).toString()}
