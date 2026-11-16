import AdminShell,{adminPageUser,isFounder} from '../admin-shell';
import AdminCoverReview from '../../../components/admin/cover-review';

export const dynamic='force-dynamic';
export const metadata={title:'ComicHuddle',robots:{index:false,follow:false}};

export default async function AdminCoversPage(){
  const user=await adminPageUser();
  return <AdminShell current="/admin/covers" title="Cover" accent=" photos." founder={isFounder(user)} lede="Approve suggested cover photos and remove ones that shouldn’t be in the directory. Every action goes in the audit log.">
    <AdminCoverReview/>
  </AdminShell>;
}
