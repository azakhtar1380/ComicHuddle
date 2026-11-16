// Per-copy ledger (migration 052: ch_web.vault_copies), kept in step with every vault save.
// Records when each copy was added and removed, its Directory issue and its normalized slab cert.
// The vault JSON stays the source of truth for the collection itself; this only adds history.
import {getPool} from '../db/postgres';
import {bookIssue} from './trades';
import {listingDirectoryId} from './shared-catalog';
import type {Vault} from './vault';

type Book=Vault['books'][number];
export const normalizeCert=(cert:string|null|undefined)=>{const digits=(cert||'').replace(/\D/g,'').replace(/^0+/,'');return digits.length>=5?digits:null};
export const copyDirectoryId=(book:Book)=>{const curated=bookIssue(book);return curated?curated.id:listingDirectoryId(book)};
export const isGraded=(book:Book)=>book.ownership?.format==='GRADED'||/^CGC\b/i.test(book.grade);
export const copyCert=(book:Book)=>isGraded(book)?normalizeCert(book.ownership?.certificationNumber):null;

/** Upserts current copies (new ones get added_at now) and stamps removed_at on copies no longer in the vault. */
export async function syncVaultLedger(userId:string,vault:Vault,now=new Date()){
 try{
  const pool=getPool();
  const rows=vault.books.map(book=>({book_id:book.id,directory_issue_id:copyDirectoryId(book),graded:isGraded(book),cert:copyCert(book)}));
  const existing=await pool.query<{n:string}>('SELECT count(*)::text AS n FROM ch_web.vault_copies WHERE user_id=$1',[userId]);
  // First sync for a collection saved before the ledger existed: its copies are marked as backfilled.
  const backfill=Number(existing.rows[0]?.n||0)===0&&rows.length>1;
  if(rows.length)await pool.query(`INSERT INTO ch_web.vault_copies AS v (user_id,book_id,directory_issue_id,graded,cert,added_at,removed_at,backfilled)
   SELECT $1,x.book_id,x.directory_issue_id,x.graded,x.cert,$3::timestamptz,NULL,$4 FROM jsonb_to_recordset($2::jsonb) AS x(book_id text,directory_issue_id bigint,graded boolean,cert text)
   ON CONFLICT (user_id,book_id) DO UPDATE SET directory_issue_id=EXCLUDED.directory_issue_id,graded=EXCLUDED.graded,cert=EXCLUDED.cert,
    removed_at=NULL,added_at=CASE WHEN v.removed_at IS NULL THEN v.added_at ELSE EXCLUDED.added_at END`,[userId,JSON.stringify(rows),now.toISOString(),backfill]);
  await pool.query(`UPDATE ch_web.vault_copies SET removed_at=$3 WHERE user_id=$1 AND removed_at IS NULL AND NOT (book_id = ANY($2::text[]))`,[userId,rows.map(r=>r.book_id),now.toISOString()]);
 }catch{/* ledger not migrated yet: the vault save itself already succeeded */}
}
/** bookId → ISO time the copy was added (current copies only). Backfills on first read. */
export async function addedDates(userId:string,vault:Vault):Promise<Record<string,{addedAt:string;backfilled:boolean}>>{
 try{
  let rows=(await getPool().query<{book_id:string;added_at:Date;backfilled:boolean}>('SELECT book_id,added_at,backfilled FROM ch_web.vault_copies WHERE user_id=$1 AND removed_at IS NULL',[userId])).rows;
  if(vault.books.some(book=>!rows.some(row=>row.book_id===book.id))){await syncVaultLedger(userId,vault);rows=(await getPool().query<{book_id:string;added_at:Date;backfilled:boolean}>('SELECT book_id,added_at,backfilled FROM ch_web.vault_copies WHERE user_id=$1 AND removed_at IS NULL',[userId])).rows}
  return Object.fromEntries(rows.map(row=>[row.book_id,{addedAt:new Date(row.added_at).toISOString(),backfilled:row.backfilled}]));
 }catch{return {}}
}
