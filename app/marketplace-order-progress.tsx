// Accessible order stepper (styles live in business-marketplace.css).
import {orderProgress,type ProgressInput} from '../lib/marketplace-order-progress';
export function OrderProgress({order}:{order:ProgressInput}){
 const {steps,complete,current,terminal,hold}=orderProgress(order);
 return <div className={'order-progress'+(terminal?' order-progress-ended':'')}>
  <ol aria-label="Order progress">{steps.map((step,index)=>{const done=index<complete,active=index===current;return <li key={step.key} className={done?'done':active?'current':'upcoming'} aria-current={active?'step':undefined}><span className="order-progress-dot" aria-hidden="true">{done?'✓':index+1}</span><span className="order-progress-label">{step.label}{step.detail&&<small>{step.detail}</small>}</span><span className="sr-only">{done?' (completed)':active?' (current step)':' (not started)'}</span></li>})}
   {terminal&&<li className={'terminal '+terminal.kind} aria-current="step"><span className="order-progress-dot" aria-hidden="true">{terminal.kind==='refunding'?'…':'■'}</span><span className="order-progress-label">{terminal.label}<small>{terminal.detail}</small></span></li>}
  </ol>
  {hold&&!terminal&&<p className="order-progress-note" role="note">{hold}</p>}
 </div>;
}
