import AdminShell,{adminPageUser,isFounder} from '../admin-shell';
import AdminAuditLog from '../../../components/admin/audit-log';

export const dynamic='force-dynamic';
export const metadata={title:'ComicHuddle',robots:{index:false,follow:false}};

export default async function AdminAuditPage(){
  const user=await adminPageUser();
  return <AdminShell current="/admin/audit" title="Audit" accent=" log." founder={isFounder(user)} lede="Every admin action, including refused attempts. Entries can’t be edited or deleted from the app.">
    <AdminAuditLog/>
  </AdminShell>;
}
