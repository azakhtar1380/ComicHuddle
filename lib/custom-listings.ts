// Admin: listings that include custom ("Add your own") comics, which aren't in the Directory. Server-only.
import {getPool} from '../db/postgres';

export type CustomListingRow={id:string;title:string;status:string;handle:string;customCount:number;customTitles:string[];createdAt:string};
export async function listingsWithCustomItems(limit=50):Promise<CustomListingRow[]>{
 try{
  const {rows}=await getPool().query<{id:string;title:string;status:string;handle:string;items:string;created_at:string}>(
   `SELECT l.id,l.title,l.status,p.handle,l.items,l.created_at FROM ch_web.listings l JOIN ch_web.profiles p ON p.id=l.seller_id
    WHERE l.items LIKE '%"source":"custom"%' ORDER BY l.created_at DESC LIMIT $1`,[limit]);
  return rows.map(row=>{let items:{source?:string;title?:string}[]=[];try{items=JSON.parse(row.items)}catch{items=[]}
   const custom=items.filter(item=>item.source==='custom');
   return {id:row.id,title:row.title,status:row.status,handle:row.handle,customCount:custom.length,customTitles:custom.slice(0,5).map(item=>String(item.title||'')),createdAt:row.created_at}});
 }catch{return []}
}
