import type {CombinedEstimate,EstimateCondition} from './estimated-fmv-types';
export const previewRulesVersion='2026-10-09-marketplace-preview-2';
export const starterGroups=[
{id:'key-hunters',name:'Key Hunters',description:'First appearances, origin stories and the hunt for your next grail.',color:'red'},
{id:'run-completers',name:'Run Completers',description:'Missing issues, full runs and the satisfaction of the last empty slot.',color:'blue'},
{id:'indie-alley',name:'Indie Alley',description:'Discover independent voices, original worlds and overlooked stories.',color:'yellow'},
{id:'twin-cities',name:'Twin Cities Collectors',description:'Minnesota collectors, local shop discoveries and community conversations.',color:'teal'}
];
export const groupChannels=[{id:'general',label:'general'},{id:'showcase',label:'show-your-shelf'},{id:'trading',label:'buy-sell-trade'}];
export type ShowcaseBook={condition?:EstimateCondition;externalCatalog?:ListingExternalCatalog;id:string;title:string;issue:string;grade:string;catalogId?:number;photoId?:string;directoryIssueId?:number;cover?:string;coverCredit?:string};
export type CollectorProfile={id:string;handle:string;name:string;bio:string;tagline:string;location:string;favorite:string;since:number;color:string;visible:boolean;dmOpen:boolean;createdAt:string;featured:string[];stats:{comics:number;wants:number;trades:number;publishers:{name:string;count:number}[]};showcase:ShowcaseBook[];tradeBooks:ShowcaseBook[];wantIds:number[];example?:boolean;provider?:{id:string;name:string};consent?:{version:string;acceptedAt:string};moderated?:boolean};
export type Group={id:string;ownerId:string|null;name:string;description:string;color:string;members:number;joined:boolean};
export type GroupPost={id:string;body:string;createdAt:string;author:{id:string;name:string;handle:string};channel:string;canDelete:boolean};
export const communityPostKinds=['discussion','question','showcase','find'] as const;
export type CommunityPostKind=typeof communityPostKinds[number];
export type CommunityAuthor={id:string;name:string;handle:string;color:string};
export type CommunityGroup=Group&{createdAt:string;postCount:number;lastActiveAt:string|null;owner:{id:string;name:string;handle:string}|null;canManage:boolean};
export type CommunityPost=GroupPost&{groupId:string;group:{id:string;name:string;color:string};kind:CommunityPostKind;title:string;photoId:string|null;lastActiveAt:string;author:CommunityAuthor;liked:boolean;likeCount:number;replyCount:number};
export type CommunityReply={id:string;postId:string;body:string;createdAt:string;author:CommunityAuthor;canDelete:boolean};
export type CommunityData={view:'feed'|'group'|'discover';groups:CommunityGroup[];activeGroup:CommunityGroup|null;posts:CommunityPost[];nextCursor:string|null;hasMore:boolean;joinedCount:number;joinRequired?:boolean;profileRequired?:boolean;signInRequired?:boolean};
export type CommunityThread={post:CommunityPost;replies:CommunityReply[];nextCursor:string|null;hasMore:boolean};
export const listingStateCodes=['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'] as const;
export type ListingFulfillment='shipping'|'pickup'|'both';
export type ListingCondition={mode:'Raw'|'CGC';grade:string;label:'Raw'|'Universal'|'Signature Series'|'Qualified'|'Restored'|'Conserved';printing:'First printing'|'Second printing'|'Third printing'|'Later printing'|'Facsimile'|'Reprint';language?:string;signatureStatus?:string;restorationStatus?:string;certificationNumber?:string};
export type ListingExternalCatalog={provider:'Metron'|'GCD';id:number;sourceUrl:string;license:'CC BY-SA 4.0'};
export type ListingItem={id:string;bookId:string;title:string;issue:string;grade:string;catalogId?:number;externalCatalog?:ListingExternalCatalog;photoId?:string;condition?:ListingCondition};
export type ListingValuation={total:number|null;knownTotal:number|null;pricedCount:number;totalCount:number;status:'complete'|'partial'|'unavailable';asOf:string|null;sourceNames:string[]};
export type ListingAuction={endAt:string;bidIncrement:number;currentBid:number|null;minNextBid:number|null;bidCount:number;ended:boolean;leading:boolean;yourBid:number|null;yourBidId:string|null;yourBidStatus:'leading'|'outbid'|null;nonbinding:true};
export type Listing={id:string;sellerId:string;bookId:string;issueId:number|null;title:string;grade:string;description:string;price:number;shipping:number;photos:string[];cert:string;status:string;createdAt:string;safePurchaseOptIn?:boolean;safePurchaseVerifiedAt?:string|null;distanceMiles?:number|null;locationCity?:string;locationState?:string;seller:{name:string;handle:string;id:string;createdAt?:string};fulfillment?:ListingFulfillment;pickupCity?:string;pickupState?:string;kind:'single'|'collection';saleType:'fixed'|'auction';items:ListingItem[];itemCount:number;valuation:ListingValuation;aiEstimate?:CombinedEstimate;auction:ListingAuction|null;example?:boolean};
export type TradeTermsStatus='pending'|'accepted'|'declined'|'cancelled';
export type TradeTermsItem=Omit<ListingItem,'photoId'>;
export type TradeProposal={id:string;threadId:string;listingId:string;listingTitle:string;buyer:{id:string;name:string;handle:string};seller:{id:string;name:string;handle:string};offeredItems:TradeTermsItem[];requestedItems:TradeTermsItem[];status:TradeTermsStatus;version:number;role:'buyer'|'seller';createdAt:string;updatedAt:string;decidedAt:string|null;canAccept:boolean;canDecline:boolean;canCancel:boolean;unavailableReason:string|null;agreementOnly:true;completed:false;protected:false};
export type TradeTermsData={proposals:TradeProposal[];hasMore:boolean;nextCursor:string|null};
export type Thread={id:string;context:string;peer:{id:string;name:string;handle:string};latest?:string;createdAt:string};
export type ChatMessage={id:string;body:string;createdAt:string;mine:boolean;authorName:string};
export type HubData={me:CollectorProfile|null;groups:Group[];people:CollectorProfile[];listings:Listing[];threads:Thread[];offers:{id:string;listingId:string;amount:number;note:string;status:string;mine:boolean;createdAt:string}[];checkoutEnabled:boolean;swipes:{pair:string;direction:string}[]};
export const emptyHub:HubData={me:null,groups:[],people:[],listings:[],threads:[],offers:[],checkoutEnabled:false,swipes:[]};
