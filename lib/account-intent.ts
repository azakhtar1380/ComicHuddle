export type AccountRole='collector'|'provider';
import {publicSection} from './section-navigation';
const sections=new Set(['Home','Directory','Marketplace','My Profile','Messages','Account','Comic Workshop']);

export function readAccountIntent(search:string):AccountRole|null{
 const role=new URLSearchParams(search).get('join');
 return role==='provider'||role==='collector'?role:null;
}

export function accountReturnPath(pathname:string,search:string,role:AccountRole,section:string):string{
 const path=pathname.startsWith('/')&&!pathname.startsWith('//')&&!/[\\\u0000-\u001f\u007f?#]/.test(pathname)?pathname:'/';
 const params=new URLSearchParams(search);
 params.set('join',role);
 const requested=publicSection(section);
 params.set('section',sections.has(requested)?requested:'Home');
 return path+'?'+params.toString();
}

export function accountSignInPath(pathname:string,search:string,role:AccountRole,section:string):string{
 return '/sign-in?return_to='+encodeURIComponent(accountReturnPath(pathname,search,role,section));
}

export function clearAccountIntent(pathname:string,search:string):string{
 const params=new URLSearchParams(search);params.delete('join');
 return pathname+(params.size?'?'+params.toString():'');
}
