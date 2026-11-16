// Transactional email templates (order receipt, sold notice, Support thank-you). Table layout and inline styles,
// because email apps ignore most CSS. Huddles images are small PNGs in /public/email, linked by absolute URL.
// Every template also has a plain-text version for apps that don't show HTML.
import {operator} from './operator';

export type EmailMessage={subject:string;preheader:string;html:string;text:string};
export type OrderEmailData={
 orderRef:string;title:string;itemCount:number;photoUrl:string|null;
 itemCents:number;shippingCents:number;feeCents:number;creditCents:number;totalCents:number;
 fulfillment:'shipping'|'pickup';shipTo:string|null;shippingService:string|null;
 buyerName:string;sellerName:string;sellerHandle:string;
 autoCharged?:{last4:string};sellerNetCents?:number;shipBy?:string|null;test:boolean;
};
const C={ink:'#20201f',ink2:'#4a463f',muted:'#6f695e',cream:'#f5f1e7',paper:'#ffffff',red:'#d7263d',yellow:'#efd369',line:'#e2dccd'};
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const usd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

function layout(origin:string,input:{preheader:string;eyebrow:string;headline:string;accent:string;art:'thank-you'|'sold'|'shield';intro:string;body:string;cta?:{label:string;href:string};footnote?:string;test?:boolean}){
 const art={'thank-you':['huddles-thank-you.png','Huddles handing over a wrapped comic'],sold:['huddles-sold.png','Huddles at the marketplace'],shield:['huddles-shield.png','Huddles with a SafePurchase shield']}[input.art];
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(input.headline)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};"><tr><td align="center" style="padding:24px 12px;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
  <tr><td align="center" style="padding:0 0 16px;"><a href="${origin}/"><img src="${origin}/email/comichuddle-logo.png" width="160" alt="ComicHuddle" style="display:block;border:0;width:160px;height:auto;"></a></td></tr>
  ${input.test?`<tr><td style="padding:0 0 12px;"><div style="background:${C.yellow};border:2px solid ${C.ink};border-radius:10px;padding:10px 14px;font:700 14px/1.4 Arial,Helvetica,sans-serif;color:${C.ink};">Test mode: no real money moved.</div></td></tr>`:''}
  <tr><td style="background:${C.paper};border:2px solid ${C.ink};border-radius:18px;box-shadow:0 6px 0 ${C.ink};">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:28px 28px 8px;">
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;">
       <div style="font:700 12px/1 Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${C.red};">${esc(input.eyebrow)}</div>
       <h1 style="margin:10px 0 0;font:800 34px/1.02 Impact,'Arial Narrow',Arial,sans-serif;text-transform:uppercase;color:${C.ink};">${esc(input.headline)}<br><span style="color:${C.red};">${esc(input.accent)}</span></h1>
      </td>
      <td width="140" valign="bottom" align="right" style="padding-left:12px;"><img src="${origin}/email/${art[0]}" width="130" alt="${art[1]}" style="display:block;border:0;width:130px;height:auto;"></td>
     </tr></table>
    </td></tr>
    <tr><td style="padding:12px 28px 4px;font:16px/1.55 Arial,Helvetica,sans-serif;color:${C.ink2};">${input.intro}</td></tr>
    <tr><td style="padding:12px 28px 8px;">${input.body}</td></tr>
    ${input.cta?`<tr><td align="left" style="padding:12px 28px 28px;"><a href="${input.cta.href}" style="display:inline-block;background:${C.red};color:#fff;border:2px solid ${C.ink};border-radius:999px;padding:14px 26px;font:700 16px/1 Arial,Helvetica,sans-serif;text-decoration:none;">${esc(input.cta.label)} &rarr;</a></td></tr>`:'<tr><td style="padding:0 0 20px;"></td></tr>'}
   </table>
  </td></tr>
  <tr><td style="padding:20px 8px 0;font:12.5px/1.6 Arial,Helvetica,sans-serif;color:${C.muted};text-align:center;">
   ${input.footnote?esc(input.footnote)+'<br>':''}
   ComicHuddle · ${esc(operator.name)} · ${esc(operator.jurisdiction)}<br>
   Questions? Reply to this email or write to <a href="mailto:${operator.supportEmail}" style="color:${C.ink};">${esc(operator.supportEmail)}</a>.<br>
   <a href="${origin}/?section=Account&amp;accountTab=Orders" style="color:${C.ink};">Your orders</a> · <a href="${origin}/contact" style="color:${C.ink};">Contact us</a>
  </td></tr>
 </table>
</td></tr></table></body></html>`;
}

function rows(lines:[string,string,boolean?][]){
 return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font:15px/1.5 Arial,Helvetica,sans-serif;color:${C.ink};">${lines.map(([label,value,strong])=>`<tr><td style="padding:6px 0;border-top:1px solid ${C.line};${strong?'font-weight:700;font-size:17px;':''}">${esc(label)}</td><td align="right" style="padding:6px 0;border-top:1px solid ${C.line};${strong?'font-weight:700;font-size:17px;':''}">${esc(value)}</td></tr>`).join('')}</table>`;
}
function item(origin:string,data:OrderEmailData){
 const photo=data.photoUrl?`<td width="84" valign="top" style="padding-right:14px;"><img src="${data.photoUrl.startsWith('http')?data.photoUrl:origin+data.photoUrl}" width="80" alt="" style="display:block;border:1px solid ${C.line};border-radius:8px;width:80px;height:auto;"></td>`:'';
 return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-radius:12px;"><tr><td style="padding:14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${photo}<td valign="top" style="font:15px/1.45 Arial,Helvetica,sans-serif;color:${C.ink};"><strong style="font-size:17px;">${esc(data.title)}</strong><br><span style="color:${C.muted};">${data.itemCount>1?data.itemCount+' comics, sold together · ':''}Order ${esc(data.orderRef)}</span><br><span style="color:${C.muted};">Seller: ${esc(data.sellerName)}${data.sellerHandle?' (@'+esc(data.sellerHandle)+')':''}</span></td></tr></table></td></tr></table>`;
}
const textRows=(lines:[string,string][])=>lines.map(([a,b])=>a+': '+b).join('\n');

/** Buyer receipt, sent once the payment is confirmed. */
export function orderReceiptEmail(origin:string,data:OrderEmailData):EmailMessage{
 const pickup=data.fulfillment==='pickup';
 const money:[string,string,boolean?][]=[['Item',usd(data.itemCents)],...(pickup?[]:[['Shipping'+(data.shippingService?' ('+data.shippingService+')':''),data.shippingCents?usd(data.shippingCents):'Free'] as [string,string]]),...(data.feeCents?[['SafePurchase',usd(data.feeCents)] as [string,string]]:[]),...(data.creditCents?[['Store credit','−'+usd(data.creditCents)] as [string,string]]:[]),['Total paid',usd(data.totalCents),true]];
 const next=pickup?'Your 6-digit pickup PIN is in Orders. Meet the seller somewhere public, check the comic, and only then show your PIN or QR code.':'The seller ships it next, and we’ll email you the tracking. Your payment is held safely until the comic is delivered.';
 const preheader=(data.autoCharged?'Your saved card was charged for the auction you won. ':'')+'Order '+data.orderRef+' · '+usd(data.totalCents);
 const intro=`Hi ${esc(data.buyerName)}, ${data.autoCharged?`you won the auction, and your saved card ending ${esc(data.autoCharged.last4)} was charged automatically.`:'thanks for your order! Your payment went through.'} Here’s your receipt.`;
 const body=item(origin,data)+'<div style="height:14px"></div>'+rows(money)+(pickup?'':data.shipTo?`<p style="margin:16px 0 0;font:14px/1.5 Arial,Helvetica,sans-serif;color:${C.ink2};"><strong style="color:${C.ink};">Shipping to</strong><br>${esc(data.shipTo).replace(/\n/g,'<br>')}</p>`:'')+`<p style="margin:16px 0 0;padding:12px 14px;background:${C.cream};border-left:4px solid ${C.red};border-radius:6px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${C.ink};"><strong>What happens next</strong><br>${esc(next)}</p>`;
 return {subject:(data.test?'[Test] ':'')+(data.autoCharged?'You won! ':'Order confirmed: ')+data.title,preheader,
  html:layout(origin,{preheader,eyebrow:data.autoCharged?'Auction won':'Order confirmed',headline:'It’s yours,',accent:'collector.',art:'thank-you',intro,body,cta:{label:pickup?'See your pickup PIN':'Track your order',href:origin+'/?section=Account&accountTab=Orders&role=buyer'},footnote:'Buyer protection covers this order. Report a problem from Orders during the review window.',test:data.test}),
  text:`${data.test?'[TEST MODE – no real money moved]\n\n':''}Hi ${data.buyerName},\n\n${data.autoCharged?`You won the auction. Your saved card ending ${data.autoCharged.last4} was charged automatically.`:'Thanks for your order! Your payment went through.'}\n\n${data.title}${data.itemCount>1?' ('+data.itemCount+' comics)':''}\nOrder ${data.orderRef} · Seller: ${data.sellerName}\n\n${textRows(money.map(([a,b])=>[a,b]))}\n${!pickup&&data.shipTo?'\nShipping to:\n'+data.shipTo+'\n':''}\nWhat happens next: ${next}\n\nYour orders: ${origin}/?section=Account&accountTab=Orders&role=buyer\n\nComicHuddle · ${operator.name} · ${operator.supportEmail}`};
}

/** Seller notice: it sold and was paid; what to do next. */
export function itemSoldEmail(origin:string,data:OrderEmailData):EmailMessage{
 const pickup=data.fulfillment==='pickup';
 const money:[string,string,boolean?][]=[['Sale price',usd(data.itemCents)],...(pickup?[]:[['Shipping paid by buyer',data.shippingCents?usd(data.shippingCents):'Free'] as [string,string]]),['You’ll receive',usd(data.sellerNetCents??0),true]];
 const next=pickup?'Arrange the meetup in Messages. At the hand-off, enter the buyer’s 6-digit PIN (or scan their QR code) in Orders. That marks it sold and releases your money.':`Pack it carefully and ship it${data.shipBy?' by '+data.shipBy:''}. You can buy the label right in Orders, and the tracking is added for you. You’re paid after delivery.`;
 const preheader='Sold to '+data.buyerName+' for '+usd(data.itemCents)+'. Next: '+(pickup?'arrange pickup.':'ship it.');
 const intro=`Nice one, ${esc(data.sellerName)}! <strong>${esc(data.title)}</strong> sold and the buyer has paid.`;
 const body=item(origin,data)+'<div style="height:14px"></div>'+rows(money)+`<p style="margin:16px 0 0;padding:12px 14px;background:${C.cream};border-left:4px solid ${C.red};border-radius:6px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${C.ink};"><strong>Your next step</strong><br>${esc(next)}</p>`;
 return {subject:(data.test?'[Test] ':'')+'Sold! '+data.title,preheader,
  html:layout(origin,{preheader,eyebrow:'You made a sale',headline:'Sold and',accent:'paid.',art:'sold',intro,body,cta:{label:pickup?'Open the order':'Ship it now',href:origin+'/?section=Account&accountTab=Orders&role=seller'},footnote:'The buyer’s address and the label button are in Orders. Never share the buyer’s details outside ComicHuddle.',test:data.test}),
  text:`${data.test?'[TEST MODE – no real money moved]\n\n':''}Nice one, ${data.sellerName}! ${data.title} sold and the buyer has paid.\n\nOrder ${data.orderRef}\n${textRows(money.map(([a,b])=>[a,b]))}\n\nYour next step: ${next}\n\nOpen the order: ${origin}/?section=Account&accountTab=Orders&role=seller\n\nComicHuddle · ${operator.name} · ${operator.supportEmail}`};
}

/** Support ComicHuddle thank-you (not a charitable donation). */
export function supportThanksEmail(origin:string,data:{amountCents:number;name:string|null;test:boolean;disclosure:string}):EmailMessage{
 const preheader='Thank you for supporting ComicHuddle with '+usd(data.amountCents)+'.';
 const intro=`${data.name?'Hi '+esc(data.name)+', t':'T'}hank you! Your ${usd(data.amountCents)} helps keep ComicHuddle running and improving for every collector.`;
 const body=rows([['Support payment',usd(data.amountCents),true]])+`<p style="margin:16px 0 0;font:13px/1.55 Arial,Helvetica,sans-serif;color:${C.muted};">${esc(data.disclosure)} Stripe sends your card receipt separately.</p>`;
 return {subject:(data.test?'[Test] ':'')+'Thank you for supporting ComicHuddle',preheader,
  html:layout(origin,{preheader,eyebrow:'Support ComicHuddle',headline:'Thank',accent:'you!',art:'thank-you',intro,body,cta:{label:'Back to ComicHuddle',href:origin+'/'},test:data.test}),
  text:`${data.test?'[TEST MODE – no real money moved]\n\n':''}${data.name?'Hi '+data.name+', t':'T'}hank you! Your ${usd(data.amountCents)} helps keep ComicHuddle running and improving.\n\n${data.disclosure}\n\nComicHuddle · ${operator.name} · ${operator.supportEmail}`};
}

/** Sample data for the admin preview page and tests. */
export function sampleOrder(overrides:Partial<OrderEmailData>={}):OrderEmailData{
 return {orderRef:'A1B2C3D4',title:'Incredible Hulk #181',itemCount:1,photoUrl:'/covers/planet-12.jpg',itemCents:125000,shippingCents:1295,feeCents:0,creditCents:0,totalCents:126295,fulfillment:'shipping',shipTo:'Sam Collector\n123 Main St\nMinneapolis, MN 55403',shippingService:'USPS Ground Advantage',buyerName:'Sam',sellerName:'Taylor',sellerHandle:'taylor_comics',sellerNetCents:116295,shipBy:'Nov 19',test:true,...overrides};
}
