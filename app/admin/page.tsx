import Link from 'next/link';
import AdminShell,{adminPageUser,isFounder} from './admin-shell';
import VerifyBusinessPanel from '../../components/profile/verify-business-panel';
import VerifyPersonPanel from '../../components/profile/verify-person-panel';
import AdminTrophiesPanel from '../../components/trophies/admin-trophies-panel';
import MemberNamesPanel from '../../components/profile/member-names-panel';
import {adminEmails,adminLimit} from '../../lib/admin';
import {adminAuditReady} from '../../lib/admin-audit';
import {protectionConfig,type ProtectionEnv} from '../../lib/commerce-protection';
import {supportPaymentsForOwner} from '../../lib/support-payments';
import {stripeMode} from '../../lib/stripe-sandbox';

export const dynamic='force-dynamic';
export const metadata={title:'ComicHuddle',robots:{index:false,follow:false}};

export default async function AdminHome(){
  const user=await adminPageUser(),founder=isFounder(user);
  const protection=protectionConfig(process.env as ProtectionEnv),auditReady=await adminAuditReady();
  const configured=adminEmails().length,limit=adminLimit();
  const support=await supportPaymentsForOwner(stripeMode(process.env as never)==='live'?0:1);
  const usd=(cents:number)=>'$'+(cents/100).toFixed(2);
  return <AdminShell current="/admin" title="Admin" accent=" tools." founder={founder} lede="Only admins can see these pages. Every action is checked on the server and written to the audit log.">
    {!auditReady&&<p className="adm-warn" role="note">Database migration 040 (audit log and SafePurchase updates) isn’t applied yet. Admin actions are refused until it is.</p>}
    <div className="adm-cards">
      <Link className="adm-card" href="/admin/safepurchase"><h2>SafePurchase</h2><p>Every SafePurchase order, its current step, and the receive → check → ship updates.</p></Link>
      <Link className="adm-card" href="/admin/covers"><h2>Cover photos</h2><p>Approve suggested cover photos and remove ones that shouldn’t be shown.</p></Link>
      <Link className="adm-card" href="/admin/audit"><h2>Audit log</h2><p>Who did what, and when.</p></Link>
      <a className="adm-card" href="#verified-businesses"><h2>Verified businesses</h2><p>Grant or remove the business verified tick.</p></a>
    </div>
    <section id="verified-businesses" aria-labelledby="adm-verified" style={{margin:'0 0 32px'}}><h2 id="adm-verified" className="adm-title" style={{fontSize:28}}>Verified businesses</h2><VerifyBusinessPanel/></section>
    <section id="verified-collectors" aria-labelledby="adm-verified-people" style={{margin:'0 0 32px'}}><h2 id="adm-verified-people" className="adm-title" style={{fontSize:28}}>Verified collectors</h2><VerifyPersonPanel/></section>
    <section id="member-names" aria-labelledby="adm-names" style={{margin:'0 0 32px'}}><h2 id="adm-names" className="adm-title" style={{fontSize:28}}>Member names</h2><MemberNamesPanel/></section>
    <section id="trophies" aria-labelledby="adm-trophies" style={{margin:'0 0 32px'}}><h2 id="adm-trophies" className="adm-title" style={{fontSize:28}}>Trophies</h2><AdminTrophiesPanel/></section>
    <section aria-labelledby="adm-support" style={{margin:'0 0 32px'}}><h2 id="adm-support" className="adm-title" style={{fontSize:28}}>Support payments</h2>
      <p className="adm-lede">Paid to ComicHuddle directly. Separate from marketplace revenue; never wallet balance, points or store credit. Total: <b>{usd(support.totalCents)}</b></p>
      {support.rows.length?<div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Date</th><th>Amount</th><th>Supporter</th><th>Status</th><th>Stripe ID</th></tr></thead><tbody>{support.rows.map(row=><tr key={row.id}><td>{row.paidAt?new Date(row.paidAt).toLocaleString('en-US'):'—'}</td><td>{usd(row.amountCents)}</td><td>{row.supporterName}</td><td>{row.status}</td><td><code>{row.stripeId}</code></td></tr>)}</tbody></table></div>:<p className="adm-empty">No support payments yet.</p>}
    </section>
    <section aria-labelledby="adm-status"><h2 id="adm-status" className="adm-title" style={{fontSize:28}}>Status</h2>
      <ul className="adm-list">
        <li>SafePurchase: {protection.safePurchaseEnabled?'on':'off'}{protection.safePurchaseEnabled?'':' (needs SAFEPURCHASE_ENABLED=true and a receiving address)'}. Threshold ${(protection.thresholdCents/100).toLocaleString('en-US')}.</li>
        <li>Receiving address: {protection.inspectionAddress?'set':'not set'}.</li>
        <li>Seller payouts: {process.env.COMMERCE_PAYOUTS_ENABLED==='true'?'switched on':'switched off'}.</li>
        <li>Admin accounts: {configured} of {limit} configured by email{founder?', plus you as Founder':', plus the Founder'}.</li>
        <li>Readiness checklist: docs/SAFEPURCHASE-READINESS.md. Payout decisions: docs/PAYOUTS-DECISIONS.md.</li>
      </ul>
    </section>
  </AdminShell>;
}
