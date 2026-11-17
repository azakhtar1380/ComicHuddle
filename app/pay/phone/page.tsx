import type {Metadata} from 'next';
import SiteHeader from '../../site-header';
import SiteFooter from '../../site-footer';
import PhonePayment from './phone-payment';

export const metadata:Metadata={title:'Pay on your phone | ComicHuddle',robots:{index:false}};

export default function PayOnPhonePage(){
 return <div className="cart-page">
  <SiteHeader section="Cart" standalone/>
  <main id="main-content" className="cart-main pay-phone-main">
   <header className="cart-head"><h1>Pay on your phone</h1><p>Finish the order you started on your computer.</p></header>
   <PhonePayment/>
  </main>
  <SiteFooter/>
 </div>;
}
