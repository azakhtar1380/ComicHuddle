// Shapes for the My Profile page (migration 051 onward). No server imports: used by client components too.
export const PROFILE_TAG_SUGGESTIONS=['Golden Age','Silver Age','Bronze Age','Modern Age','Key hunter','Run completer','Slab collector','Indie reader','Open to trades','Local pickup','Back issues','New releases'] as const;
export const MAX_PROFILE_TAGS=4;
export const profileTagPattern=/^[A-Za-z0-9][A-Za-z0-9 &'.\-]{0,23}$/;
export type ProfileIssueRef={issueId:number;title:string;number:string;year:number|null};
export type ProfileExtras={
 coverUrl:string|null;
 tags:string[];
 favoriteCharacter:{id:number;name:string;firstAppearance:ProfileIssueRef|null}|null;
 favoriteComic:(ProfileIssueRef&{keyNote:string|null})|null;
 grail:(ProfileIssueRef&{reward:string})|null;
 keys:number;
 rating:{stars:number|null;percent:number|null;count:number}|null;
 latestReview:{text:string;by:string}|null;
 share:{wishlist:boolean;reviews:boolean;city:boolean};
};
export const defaultShare={wishlist:true,reviews:true,city:true};
export const emptyExtras:ProfileExtras={coverUrl:null,tags:[],favoriteCharacter:null,favoriteComic:null,grail:null,keys:0,rating:null,latestReview:null,share:defaultShare};
export const profilePath=(handle:string)=>'/@'+handle;
