import type {Metadata} from 'next';
import SiteHeader from '../site-header';
import SiteFooter from '../site-footer';
import SignInForm from './sign-in-form';
import {appleEnabled,googleEnabled} from '../../lib/social-auth';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Log in or join | ComicHuddle',description:'Join ComicHuddle free to save comics, sell, trade and chat with collectors.'};

export default async function SignInPage({searchParams}:{searchParams:Promise<{mode?:string;social?:string}>}){
 const params=await searchParams;
 return <div className="auth-page">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <SiteHeader section="Account" standalone/>
  <SignInForm initialRegister={params.mode==='register'} social={{google:googleEnabled(),apple:appleEnabled(),failed:params.social==='error'}}/>
  <SiteFooter/>
 </div>;
}
