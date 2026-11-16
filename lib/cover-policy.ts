// Which cover images the site may show. Owner decision 2026-11-16, after Metron declined to license covers:
// covers come from members' own photos (a seller's front listing photo, unless they opt out, then a
// collector-submitted cover) plus a few reviewed US public-domain files. Publisher art from catalog sources
// (GCD links, the S3 cover cache, our Metron copies or links, character portraits) stays off unless
// CATALOG_ART_COVERS=on. Member photos always come first, even when catalog art is on.
export const catalogArtCovers=(env:Record<string,string|undefined>=process.env)=>env.CATALOG_ART_COVERS==='on';
