'use client';
import {useRef,useState} from 'react';
import {ArrowUpRight,Gift,Wallet} from 'lucide-react';
export function CollectorWallet({availableCents,points,enabled,onWithdraw,onRedeem}:{availableCents:string;points:string;enabled:boolean;onWithdraw:(amountCents:string,key:string)=>Promise<void>;onRedeem:(points:string,key:string)=>Promise<void>}){
 const withdrawKey=useRef<{amount:string;key:string}|null>(null),redeemKey=useRef<{points:string;key:string}|null>(null);
 const [amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await action();setNotice('Request received. Your history will show the confirmed outcome.')}catch(e){setError(e instanceof Error?e.message:'Unable to complete this request.')}finally{setBusy(false)}}
 const format=(n:string)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)/100);
 return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="m-0 flex items-center gap-2 text-xl font-bold"><Wallet size={22}/> Collector wallet</h2><span className="text-xs font-bold text-slate-500">{enabled?'Seller proceeds':'Coming soon'}</span></div>
  <p className="mt-5 text-sm text-slate-500">Available sales proceeds</p><strong className="text-4xl">{format(availableCents)}</strong><p className="mt-2 text-xs">Earned seller funds; this account does not accept cash top-ups.</p>
  <label className="mt-4 block text-sm">Bank withdrawal amount (USD)<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl border border-slate-200 p-3" placeholder="0.00"/></label>
  <button disabled={!enabled||busy} onClick={()=>void run(async()=>{if(!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount))throw new Error('Enter a valid dollar amount.');const [a,b='']=amount.split('.');const cents=(BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,'0'))).toString();if(withdrawKey.current?.amount!==cents)withdrawKey.current={amount:cents,key:crypto.randomUUID()};await onWithdraw(cents,withdrawKey.current.key)})} className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 p-3 text-sm font-bold text-white">Request bank payout <ArrowUpRight className="inline" size={16}/></button>
  <div className="mt-5 border-t border-slate-200 pt-4"><span className="flex items-center gap-2 text-sm"><Gift size={18}/>{points} reward points</span><button disabled={!enabled||busy||points==='0'} onClick={()=>void run(()=>{if(redeemKey.current?.points!==points)redeemKey.current={points,key:crypto.randomUUID()};return onRedeem(points,redeemKey.current.key)})} className="mt-2 min-h-10 text-sm font-bold text-[#345a6a]">Apply points at checkout</button><p className="text-xs">Loyalty points are purchase discounts, not withdrawable cash.</p></div>
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
 </section>;
}
