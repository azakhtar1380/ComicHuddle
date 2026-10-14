import {defaultSafeTrade} from './src/escrow';
import {defaultWallet} from './src/wallet';
import {defaultRewards} from './src/rewards';
import {defaultSources} from './src/fmv';
// Safe defaults. Resolve secret values only in the deployment's secret manager;
// do not commit credentials or expose them through NEXT_PUBLIC_* variables.
export const platformConfiguration={
 launchCountry:'US' as const,
 paymentsEnabled:false,
 platformFeeBps:800,
 safetrade:{...defaultSafeTrade,thresholdCents:'50000',inclusive:true},
 wallet:{...defaultWallet},
 rewards:{...defaultRewards,pointsPerDollar:1,centsPerPoint:1,maxDiscountBps:1000,listingPoints:0},
 sources:defaultSources,
 ebay:{environment:'sandbox' as const,productionApproved:false},
};
