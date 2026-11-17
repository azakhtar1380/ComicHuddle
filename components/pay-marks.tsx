// "Apple Pay · Google Pay · Card" hint next to payment buttons. Plain text marks: the official buttons themselves
// are drawn by Stripe in the payment form (they appear on devices and browsers that support them).
import {CreditCard} from 'lucide-react';
export default function PayMarks({className=''}:{className?:string}){
 return <span className={'pay-marks '+className} aria-label="Apple Pay, Google Pay or card">
  <span className="pay-mark pay-mark-apple" aria-hidden="true">Apple Pay</span>
  <span className="pay-mark pay-mark-google" aria-hidden="true"><b>G</b> Pay</span>
  <span className="pay-mark pay-mark-card" aria-hidden="true"><CreditCard size={14}/> Card</span>
 </span>;
}
