'use client';
// "Add to cart" for an active fixed-price listing (mount it next to Buy now). The server re-checks
// everything (not your own, not an auction, still active), and the message shows inline if it refuses.
// Guests: the comic is kept in this browser (no sign-in needed); sign-in is asked for at checkout, and the
// cart moves into their account after that.
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Check, ShoppingCart} from 'lucide-react';
import {addToGuestCart, applyCartResponse, notifyCartChanged, useCartState} from './cart-store';
import '../../app/mobile-dock.css';
import './cart.css';

export function AddToCartButton({listingId, compact = false}: {listingId: string; compact?: boolean}) {
  const cart = useCartState(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const router = useRouter();
  const inCart = cart.listingIds.includes(listingId) || cart.savedIds.includes(listingId);
  async function add(event: React.MouseEvent) {
    // Cards are often clickable as a whole; this button must not open the card.
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    if (inCart) { router.push('/cart'); return; }
    setError('');
    if (cart.loaded && !cart.signedIn) { addToGuestCart(listingId); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/cart', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'add', listingId})});
      const body = await response.json().catch(() => ({})) as {error?: string};
      if (response.status === 401) { addToGuestCart(listingId); return; }
      if (!response.ok) { setError(body.error || 'Couldn’t add it to your cart. Try again.'); return; }
      applyCartResponse(body); notifyCartChanged();
    } catch { setError('Couldn’t reach ComicHuddle. Check your connection.'); }
    finally { setBusy(false); }
  }
  const label = inCart ? 'In cart' : busy ? 'Adding…' : 'Add to cart';
  return <span className={'cart-add' + (compact ? ' is-compact' : '')} onClick={event => event.stopPropagation()}>
    <button type="button" className={'ds-btn ' + (compact ? 'ds-btn-sm ' : '') + (inCart ? 'ds-btn-secondary cart-add-in' : 'ds-btn-yellow')} onClick={event => void add(event)} disabled={busy} aria-label={inCart ? 'In your cart. Open cart' : 'Add to cart'} title={inCart ? 'Open your cart' : undefined}>
      {inCart ? <Check size={compact ? 15 : 17} aria-hidden /> : <ShoppingCart size={compact ? 15 : 17} aria-hidden />}
      {compact && !inCart ? <span className="cart-add-short">Cart</span> : <span>{label}</span>}
    </button>
    {error && <small className="cart-add-error" role="alert">{error}</small>}
  </span>;
}

export default AddToCartButton;
