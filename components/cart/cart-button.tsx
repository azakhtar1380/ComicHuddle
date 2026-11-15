'use client';
// Cart icon with a live item count. variant="header" matches the desktop header icons (.chx-icon);
// variant="dock" matches the phone bottom bar tabs (.dock3-tab).
import Link from 'next/link';
import {ShoppingCart} from 'lucide-react';
import {useCartCount} from './cart-store';
import './cart.css';

export {useCartCount, notifyCartChanged, CART_CHANGED_EVENT} from './cart-store';

export function CartButton({variant}: {variant: 'header' | 'dock'}) {
  const count = useCartCount(), shown = count > 99 ? '99+' : String(count);
  const label = 'Cart' + (count ? ` (${count} ${count === 1 ? 'item' : 'items'})` : '');
  if (variant === 'dock') return <Link href="/cart" className="dock3-tab cart-dock" aria-label={label}>
    <span className="dock3-icon"><ShoppingCart size={22} strokeWidth={2.2} />{count > 0 && <b className="cart-dock-badge" aria-hidden="true">{shown}</b>}</span><span className="dock3-label">Cart</span>
  </Link>;
  return <Link href="/cart" className="chx-icon cart-header" aria-label={label}>
    <ShoppingCart size={22} />{count > 0 && <span className="chx-badge" aria-hidden="true">{shown}</span>}<span className="chx-icon-label">Cart</span>
  </Link>;
}

export default CartButton;
