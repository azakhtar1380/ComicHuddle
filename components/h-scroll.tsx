'use client';
// The one horizontal scroll row used across the site (chips, racks, carousels). Swipe and trackpad scroll it.
// The scroll bar is hidden at rest and shows thin only while scrolling or hovering. No arrow buttons.
// Styles: .ch-hscroll in app/design-system-hscroll.css.
import {useRef,type HTMLAttributes,type ReactNode} from 'react';
import '../app/design-system-hscroll.css';

export default function HScroll({children,className='',as:Tag='div',...rest}:{children:ReactNode;className?:string;as?:'div'|'ul'|'nav'}&HTMLAttributes<HTMLElement>){
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 return <Tag {...rest} className={'ch-hscroll '+className} onScroll={event=>{const el=event.currentTarget;el.classList.add('is-scrolling');if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>el.classList.remove('is-scrolling'),700)}}>{children}</Tag>;
}
