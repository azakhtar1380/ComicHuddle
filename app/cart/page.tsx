import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import CartView from './cart-view';
import '../../components/cart/cart.css';

export const metadata:Metadata={title:'Your Cart | ComicHuddle',description:'Comics in your ComicHuddle cart, grouped by seller.',robots:{index:false}};

export default function CartPage(){
 return <div className="cart-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Cart" standalone/>
  <main id="main-content" className="cart-main">
   <header className="cart-head"><h1>Your cart</h1><p>Grouped by seller. Each seller ships their comics separately.</p></header>
   <CartView/>
  </main>
  <SiteFooter/>
 </div>;
}
