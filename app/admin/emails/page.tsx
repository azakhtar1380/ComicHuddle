import {headers} from 'next/headers';
import AdminShell,{adminPageUser,isFounder} from '../admin-shell';
import {emailConfigured} from '../../../lib/email';
import {itemSoldEmail,orderReceiptEmail,sampleOrder,supportThanksEmail} from '../../../lib/email-templates';
import {SUPPORT_DISCLOSURE} from '../../../lib/support-payments';

export const dynamic='force-dynamic';
export const metadata={title:'ComicHuddle',robots:{index:false,follow:false}};

/** Admin preview of every customer email, with sample data. Nothing is sent from this page. */
export default async function AdminEmailsPage(){
 const user=await adminPageUser(),h=await headers(),origin=(h.get('x-forwarded-proto')||'https')+'://'+(h.get('x-forwarded-host')||h.get('host')||'localhost');
 const samples=[
  {name:'Buyer receipt (shipped)',message:orderReceiptEmail(origin,sampleOrder())},
  {name:'Buyer receipt (auction, saved card charged)',message:orderReceiptEmail(origin,sampleOrder({autoCharged:{last4:'4242'}}))},
  {name:'Buyer receipt (local pickup)',message:orderReceiptEmail(origin,sampleOrder({fulfillment:'pickup',shippingCents:0,totalCents:125000,shipTo:null,shippingService:null}))},
  {name:'Seller: sold and paid',message:itemSoldEmail(origin,sampleOrder())},
  {name:'Support ComicHuddle thank-you',message:supportThanksEmail(origin,{amountCents:1000,name:'Sam',test:true,disclosure:SUPPORT_DISCLOSURE})},
 ];
 return <AdminShell current="/admin/emails" title="Customer" accent=" emails." founder={isFounder(user)} lede={emailConfigured()?'These go out automatically after payments. Previews use sample data.':'Sending is off until an email service is connected (RESEND_API_KEY and EMAIL_FROM). Previews use sample data.'}>
  <div style={{display:'grid',gap:28}}>{samples.map(sample=><section key={sample.name} aria-label={sample.name}>
   <h2 style={{margin:'0 0 4px',font:'800 22px/1.1 var(--font-display)',textTransform:'uppercase'}}>{sample.name}</h2>
   <p style={{margin:'0 0 10px',color:'var(--muted)'}}>Subject: <strong>{sample.message.subject}</strong></p>
   <iframe title={sample.name} srcDoc={sample.message.html} sandbox="" style={{width:'100%',maxWidth:680,height:860,border:'2px solid var(--ink)',borderRadius:12,background:'#fff'}}/>
  </section>)}</div>
 </AdminShell>;
}
