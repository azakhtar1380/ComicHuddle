import AdminShell,{adminPageUser,isFounder} from '../admin-shell';
import SafePurchaseDashboard from '../../../components/admin/safepurchase-dashboard';

export const dynamic='force-dynamic';
export const metadata={title:'ComicHuddle',robots:{index:false,follow:false}};

export default async function AdminSafePurchasePage(){
  const user=await adminPageUser();
  return <AdminShell current="/admin/safepurchase" title="SafePurchase" accent=" orders." founder={isFounder(user)} lede="Paid → Seller shipped → Received → Checked → Shipped to buyer → Delivered → Done. Each update notifies the buyer and the seller.">
    <SafePurchaseDashboard/>
  </AdminShell>;
}
