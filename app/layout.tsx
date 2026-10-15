import './globals.css';
import './business-marketplace.css';
import './experience-polish.css';
import './collector-controls.css';
export const metadata={title:'ComicHuddle — Your collection deserves a spotlight',description:'A collector marketplace, comic directory, grail profiles, groups, messaging, swipe-based trades and a community-rated pressing specialist directory.',manifest:'/manifest.webmanifest',icons:{icon:'/icons/comichuddle-hero-64.png',apple:'/icons/comichuddle-hero-180.png'},appleWebApp:{capable:true,title:'ComicHuddle',statusBarStyle:'default'}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f5f1e7'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang='en'><body>{children}</body></html>}
