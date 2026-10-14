import {randomUUID} from 'node:crypto';
export const catalog=[12,27,55].map((number,index)=>({id:'planet-'+number,title:'Planet Comics',number:String(number),publisher:'Fiction House',variant:'Vintage US edition',cover:'/covers/planet-'+number+'.jpg',imageCredit:'US public-domain cover; retained source credits in the full directory',samplePrices:{raw_nm:[12000,18000,24000][index],cgc_9_6_universal:[40000,50000,60000][index],cgc_9_8_universal:[60000,75000,90000][index]}}));
export const initial=()=>({collection:[],listings:[],orders:[],walletCents:0,points:0,history:[]});
export function exportCsv(listings){
 const cell=s=>'"'+String(s??'').replaceAll('"','""')+'"';
 return [['Internal Listing ID','Title','Publisher','Issue','Grade','Price USD','Quantity','Condition report'],...listings.map(l=>[l.id,l.title+' #'+l.number,l.publisher,l.number,l.grade,(l.priceCents/100).toFixed(2),1,'Seller-declared condition. No authenticity claim.'])].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function change(state,input){
 if(input.grade&&!['raw_nm','cgc_9_6_universal','cgc_9_8_universal'].includes(input.grade))throw Error('Choose a supported grade.');
 const s=structuredClone(state);const comic=catalog.find(c=>c.id===input.comicId);
 if(input.action==='collect'){if(!comic)throw Error('Choose a catalog issue.');s.collection.push({...comic,copyId:randomUUID(),grade:input.grade||'raw_nm'});}
 else if(input.action==='list'){if(!comic)throw Error('Choose a catalog issue.');const amount=Number(input.priceCents);if(!Number.isSafeInteger(amount)||amount<50||amount>99999999)throw Error('Enter a valid price.');s.listings.push({...comic,id:randomUUID(),grade:input.grade||'raw_nm',priceCents:amount});}
 else if(input.action==='purchase'){const l=s.listings.find(l=>l.id===input.listingId);if(!l)throw Error('Choose your sandbox listing.');s.orders.push({...l,orderId:randomUUID(),status:'pending_deposit',pointsApplied:0,amountPaid:l.priceCents});}
 else if(input.action==='advance'){
  const o=s.orders.find(o=>o.orderId===input.orderId);if(!o)throw Error('Order not found.');
  const path=['pending_deposit','funded','seller_shipped','received_at_vault','inspected','shipped_to_buyer','delivered','completed'];
  const index=path.indexOf(o.status);if(index<0||index===path.length-1)throw Error('Order already finished.');o.status=path[index+1];
  if(o.status==='completed'){s.walletCents+=Math.floor(o.priceCents*.92);s.points+=Math.floor(o.amountPaid/100);s.history.push({type:'Demo seller proceeds',amountCents:Math.floor(o.priceCents*.92)});}
 }
 else if(input.action==='refund'){const o=s.orders.find(o=>o.orderId===input.orderId);if(!o||['pending_deposit','completed','refunded'].includes(o.status))throw Error('Only a funded unsettled demo order can be refunded.');o.status='refunded';s.points+=o.pointsApplied;s.history.push({type:'Demo buyer refund',amountCents:o.amountPaid});}
 else if(input.action==='redeem'){const o=s.orders.find(o=>o.orderId===input.orderId);if(!o||o.status!=='pending_deposit'||o.pointsApplied)throw Error('Redeem before payment.');const discount=Math.min(s.points,Math.floor(o.priceCents*.08));if(!discount)throw Error('Earn points by completing a demo purchase first.');s.points-=discount;o.pointsApplied=discount;o.amountPaid-=discount;}
 else if(input.action==='withdraw'){if(s.walletCents===0)throw Error('No demo proceeds available.');s.history.push({type:'Demo bank payout',amountCents:s.walletCents});s.walletCents=0;}
 else if(input.action==='reset')return initial();
 else throw Error('Unknown action.');return s;
}
