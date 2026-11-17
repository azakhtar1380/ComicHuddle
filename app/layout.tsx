import './globals.css';
import './business-marketplace.css';
import './experience-polish.css';
import './collector-controls.css';
import './theme-pro.css';
import './design-system.css';
import './smooth.css';
export const metadata={title:'ComicHuddle: know the book, own the story',description:'Track your comics, find any issue, and buy, sell or trade with real collectors.',manifest:'/manifest.webmanifest',icons:{icon:'/icons/comichuddle-hero-64.png',apple:'/icons/comichuddle-hero-180.png'},appleWebApp:{capable:true,title:'ComicHuddle',statusBarStyle:'default'}};
export const viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f5f1e7'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang='en'><body>{children}</body></html>}
