// Display name and @handle rules (cleanup round): change limits, reserved staff words, and a starter list of
// offensive words. Shared by the profile action (server) and the Edit profile form (counts only).
// Regular members get 2 name changes and 2 handle changes for the life of the account; setting them when the
// profile is created doesn't count. Admins and the Founder are unlimited.

export const NAME_CHANGE_LIMIT=2,HANDLE_CHANGE_LIMIT=2;
export const HANDLE_RESERVE_DAYS=30,HANDLE_REDIRECT_DAYS=90;
export const handlePattern=/^[a-z][a-z0-9_]{2,23}$/;

/** Changes left (null = unlimited). */
export function changesLeft(used:number,limit:number,unlimited:boolean){return unlimited?null:Math.max(0,limit-Math.max(0,used|0))}
export function changesNote(left:number|null){return left===null?'':left===0?'No changes left — contact support':left===1?'1 change left':left+' changes left'}

// Look-alike letters people use to get around a word list.
const LEET:Record<string,string>={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','@':'a','$':'s','!':'i','|':'l'};
/** Lowercase letters only, with look-alike digits turned into letters ("Adm1n_Supp0rt" → "adminsupport"). */
export function squash(value:string){return [...value.toLowerCase()].map(c=>LEET[c]??c).join('').replace(/[^a-z]/g,'')}

// Staff and brand words regular members can't use in a handle or a display name.
const RESERVED=['admin','administrator','comichuddle','founder','support','staff','moderator','official','helpdesk','huddlesupport'];
// "mod" alone is too common inside real words (modern, model): blocked only as a whole handle part or word.
const RESERVED_WHOLE=['mod','mods','team'];
export function reservedReason(value:string,kind:'name'|'handle'){
 const flat=squash(value);
 if(RESERVED.some(word=>flat.includes(word)))return kind==='handle'?'That handle is reserved for ComicHuddle staff.':'That name is reserved for ComicHuddle staff.';
 const parts=value.toLowerCase().split(kind==='handle'?/_+/:/[^a-z0-9]+/).map(squash).filter(Boolean);
 if(parts.some(part=>RESERVED_WHOLE.includes(part)))return kind==='handle'?'That handle is reserved for ComicHuddle staff.':'That name is reserved for ComicHuddle staff.';
 return null;
}

// Starter list of offensive word roots (matched after squashing). Roots that hide inside ordinary names
// (Hancock, Dickens) are left out. Extend as moderation finds new ones.
const OFFENSIVE=['fuck','shit','cunt','bitch','whore','slut','nigg','fagg','faggot','kike','spick','chink','wetback','tranny','retard','rapist','nazi','hitler','porn','pussy','twat','wank','jizz','kkk'];
export function offensiveReason(value:string){
 const flat=squash(value);
 return OFFENSIVE.some(word=>flat.includes(word))?'Pick something else: that word isn’t allowed on ComicHuddle.':null;
}
