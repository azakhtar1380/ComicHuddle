// Collector rules as a real page: a short plain version of each section, with the full wording
// one tap away in "Full details".
import {operator} from '../lib/operator';
import PageHeader from '../components/page-header';
import {HowItWorks} from '../components/states';

const sections:{id:string;title:string;short:string[];full:string[]}[]=[
 {id:'who',title:'Who can use ComicHuddle',short:['You need to be 18 or older and live in the United States.','Listings and shipping are US-only.'],
  full:[`ComicHuddle is operated by ${operator.name}, based in ${operator.jurisdiction}. ComicHuddle is for adults 18 or older based in the United States, with USA-only listings and domestic shipping. Contact ${operator.supportEmail} for account help, privacy requests or content concerns. The company and contact details were supplied by the operator; no legal-clearance or insurance guarantee is implied.`]},
 {id:'privacy',title:'Your account and privacy',short:['Your full collection and what you paid stay private.','You choose what your showcase shows.','You can export or delete your data any time in Settings.'],
  full:['A free collector profile is required to save comics, message or list. Use a display name; keep precise addresses, financial information and private contact details out of your profile. Your full collection and estimates stay private. Discovery makes featured books, marked trade books, wants and self-reported collection counts visible to site members.',
   'Private messages are available to conversation participants. A message reported for a concern can be reviewed by the site owner. Uploaded photos are shared only when featured, marked for trade or used in an active listing. Photos prepared by the site have their embedded location metadata removed.',
   'Hide your showcase or turn off messages through Edit showcase. Export your collection from Settings. For accounts without sandbox order history, Delete my ComicHuddle data removes your collection, profile, content and uploads; it does not delete your sign-in account. Minimal account restriction records are retained for abuse prevention until reviewed by the owner. Rule acceptance version and date are private and included in your account export. Hosting backups, security logs and statutory retention need a published policy before a public commercial launch.']},
 {id:'selling',title:'Selling, offers and auctions',short:['Only list comics you own and can legally sell.','Describe the printing, defects and condition honestly.','Offers and auction bids here are previews. Nobody gets charged.'],
  full:['List one owned comic or select an entire collection or bundle. The list of included copies is shared with members; what you paid stays private. Each physical copy can belong to one active listing. Fixed asking prices and auction bids are shown separately.',
   'Auction bids here are nonbinding previews. No card charge, paid order or purchase commitment is created. The server controls the cutoff and minimum bid increase. Seller and agent bids are prohibited. A bidder may retract before the auction closes; a retracted leading bid does not reinstate earlier bids. A seller cannot withdraw an auction after an accepted bid; contact support about genuine errors. Owner cancellation for moderation is available.',
   'A bidder must retract any still-open bids before deleting their account. After closure or cancellation, bidder deletion anonymizes retained bid amounts and timestamps and removes private identity and request receipts. A seller whose auction has any accepted bid history must ask support for owner cancellation before account deletion. Export your account records before deleting.',
   'Adults 18+ only. List genuine books you own and can legally sell. Describe printing, defects, restoration and condition accurately. Upload photos you took or have permission to use. CGC certificate numbers and collection claims are self-reported; use the CGC certificate lookup to check them.',
   'Offers and auction bids are expressions of interest. Neither creates a paid order, a shipment obligation or guaranteed protection. Do not send payments outside ComicHuddle expecting us to insure or reverse them. Block unwanted messages; report profiles, listings and messages for owner review.']},
 {id:'payments',title:'Payments, orders and refunds',short:['Card payments run through Stripe where checkout is on for a listing.','On this test site, no real money moves.'],
  full:['Card and wallet payments are processed by Stripe wherever checkout is available for a listing. Sales-tax calculation, carrier-verified tracking, seller payouts and SafePurchase inspection are rolling out in stages; each feature shows its status where you use it.',
   'Orders & refunds is a sandbox-only flow on this test site. No live funds are enabled. The proposed tracking deadline is 48 hours, carrier handoff 72 hours, and delivery review 48 hours before seller transfer. Submitted tracking is unverified until a carrier integration confirms it. Buyer issues freeze release. The timer does not waive later refund or card-dispute rights; final policies are required before real sales.',
   'Sandbox order history requires support review before account removal so records are not silently deleted. Orders remain available in your private account export. A Stripe refund is separate from seller transfer recovery; ComicHuddle does not provide escrow or insurance today. Automatic carrier verification, scheduled execution, live tax and post-release recoveries are not connected yet.']},
 {id:'workshop',title:'Comic Workshop',short:['Workshop pros are independent. You pay them directly.','Pressing can’t guarantee a grade and can damage a book.'],
  full:['Independent providers register their own services, prices and portfolio. Ratings represent member opinions; a completed-request badge records a collector’s receipt confirmation, not verified identity or workmanship. Provider and review reports go to owner review. One account can have both a collector showcase and a pressing studio.',
   'Care requests, quote terms, declared values, condition photos and addresses are visible only to the collector and provider. Private care photos do not become public through a review or portfolio unless their owner explicitly publishes a separate copy. Providers’ intake addresses unlock after quote acceptance. Timeline and tracking updates are entered by hand, with no connected courier or CGC verification. Payment, insured shipping, liability, cancellation and return arrangements must be agreed directly. ComicHuddle does not take custody of books or insure a service.',
   'Pressing and dry cleaning cannot guarantee grade improvement and may damage a book. Restoration and handling authenticated signatures require separate assessment and authorization. CGC collector memberships cannot submit for third parties; dealer submission eligibility is self-declared here and must be independently checked before the collector authorizes submission. CGC alone assigns its grades.']},
 {id:'data',title:'Comic data and cover images',short:['Comic details come from the Grand Comics Database and Metron.','Cover art belongs to its publishers and creators.'],
  full:['The Directory shows its current coverage and is not complete. Sources appear on each issue. Metadata adapted from the Grand Comics Database and Metron keeps its attribution and CC BY-SA 4.0 license; that license does not cover artwork. Vintage cover source pages label some images as US public domain because copyright was not renewed; that status is not a worldwide clearance.',
   'Documented CGC sale results are dated historical facts with links to their source. They are individual sales, not a current market value, a trend or an investment recommendation. Value estimates on ComicHuddle are worked out from recorded sales with our own rules; they are not appraisals. Members do not need a Metron or Comic Vine account to search the directory.']},
 {id:'brand',title:'About ComicHuddle',short:['ComicHuddle is independent.','We’re not endorsed by Marvel, DC, Image, Mirage or CGC.'],
  full:['ComicHuddle is a provisional brand with an original letter mark. It is not endorsed by Marvel, DC, Image, Mirage or CGC. Publisher and grading names identify books and services; their logos and characters are not used as the platform brand. Licensed character merchandise is not offered here.',
   'Before taking public payments the operator must obtain brand clearance and appropriate data and image rights, connect marketplace onboarding and payments, set seller identity and return and dispute procedures, verify the operator and contact details, publish final terms and privacy policies, and set up required tax and copyright notice processes. These rules do not establish that the business is legally cleared.']},
];

export default function RulesPage(){
 return <section className="rules-page">
  <PageHeader eyebrow="Collector rules" title="Good books." accent="Good collector energy." lede="The short version of how ComicHuddle works. Tap “Full details” for the exact wording."/>
  <div className="rules-layout">
   <nav className="rules-toc" aria-label="On this page"><p className="ds-eyebrow">On this page</p><ol>{sections.map(s=><li key={s.id}><a href={'#rules-'+s.id}>{s.title}</a></li>)}</ol></nav>
   <div className="rules-body">{sections.map(s=><section key={s.id} id={'rules-'+s.id} className="rules-section" aria-labelledby={'rules-'+s.id+'-title'}>
    <h2 id={'rules-'+s.id+'-title'}>{s.title}</h2>
    <ul>{s.short.map(line=><li key={line}>{line}</li>)}</ul>
    <HowItWorks title="Full details">{s.full.map((p,i)=><p key={i}>{p}</p>)}</HowItWorks>
   </section>)}
    <p className="rules-contact">Questions? Email <a href={'mailto:'+operator.supportEmail}>{operator.supportEmail}</a>.</p>
   </div>
  </div>
 </section>;
}
