// Plain constants with no server imports, safe for client components such as the footer.
export const CC_BY_SA_URL='https://creativecommons.org/licenses/by-sa/4.0/';
/** Footer credit for catalog metadata (CC BY-SA 4.0 requires attribution + license link). */
export const CATALOG_DATA_CREDIT='Comic catalog data from the Grand Comics Database (comics.org) and Metron (metron.cloud), used under CC BY-SA 4.0; ComicHuddle has formatted and combined it. Cover images are © their respective publishers and creators.';
export const CATALOG_DATA_CREDIT_LINKS=[
 {label:'Grand Comics Database',href:'https://www.comics.org/'},
 {label:'Metron',href:'https://metron.cloud/'},
 {label:'CC BY-SA 4.0',href:CC_BY_SA_URL},
] as const;
export const METRON_DATA_CREDIT='Issue data: Metron (metron.cloud), CC BY-SA 4.0';
export const METRON_COVER_ATTRIBUTION='Cover © its publisher and creators · image via Metron (metron.cloud)';
