-- Avoid repeated full scans of the actively loaded snapshot for legacy IDs.
CREATE OR REPLACE VIEW gcd.comichuddle_directory AS
 SELECT 4000000000::bigint+i.id AS id,i.id::bigint AS gcd_id,NULL::bigint AS metron_id,
  s.name AS title,COALESCE(i.number,'') AS number,COALESCE(p.name,'Publisher not recorded') AS publisher,
  y.year,CASE WHEN y.year=0 THEN 'Date not recorded' WHEN y.year<1956 THEN 'Golden Age' WHEN y.year<1970 THEN 'Silver Age' WHEN y.year<1985 THEN 'Bronze Age' WHEN y.year<1992 THEN 'Copper Age' ELSE 'Modern Age' END AS era,
  COALESCE(c.kind,'Catalog issue') AS kind,
  lower(concat_ws(' ',s.name,i.number,p.name,i.title,LEFT(i.notes,1200),i.barcode,c.search_text)) AS search_text,
  ((COALESCE(c.data::jsonb,'{}'::jsonb)) || jsonb_build_object(
   'id',4000000000::bigint+i.id,'gcdId',i.id,'title',s.name,'number',COALESCE(i.number,''),'publisher',COALESCE(p.name,'Publisher not recorded'),
   'year',y.year,'era',CASE WHEN y.year=0 THEN 'Date not recorded' WHEN y.year<1956 THEN 'Golden Age' WHEN y.year<1970 THEN 'Silver Age' WHEN y.year<1985 THEN 'Bronze Age' WHEN y.year<1992 THEN 'Copper Age' ELSE 'Modern Age' END,
   'kind',COALESCE(c.kind,'Catalog issue'),'variant',COALESCE(NULLIF(i.variant_name,''),c.data::jsonb->>'variant','Edition record · printing must be confirmed'),
   'characters',COALESCE(c.data::jsonb->'characters','[]'::jsonb),'writer',COALESCE(c.data::jsonb->>'writer','Not recorded'),'artist',COALESCE(c.data::jsonb->>'artist','Not recorded'),
   'note',COALESCE(NULLIF(LEFT(i.notes,1200),''),c.data::jsonb->>'note','GCD bibliographic record. Confirm the physical edition and printing.'),
   'source','https://www.comics.org/issue/'||i.id||'/',
   'dataCredit','Bibliographic data from the Grand Comics Database; selected and formatted by ComicHuddle',
   'dataLicense','https://creativecommons.org/licenses/by-sa/4.0/',
   'bibliography',jsonb_build_object('publicationDate',COALESCE(NULLIF(c.data::jsonb->'bibliography'->>'publicationDate',''),i.publication_date,''),'keyDate',COALESCE(i.key_date,''),'onSaleDate',COALESCE(NULLIF(c.data::jsonb->'bibliography'->>'onSaleDate',''),i.on_sale_date,''),
    'originalCoverPrice',jsonb_build_object('kind','ORIGINAL_COVER_PRICE','text',COALESCE(i.price,'')),'pageCount',COALESCE(i.page_count::text,''),
    'isbn',COALESCE(i.isbn,''),'barcode',COALESCE(NULLIF(c.data::jsonb->'bibliography'->>'barcode',''),i.barcode,''),'issueTitle',COALESCE(i.title,''),'volume',COALESCE(i.volume,''),'variantOf',i.variant_of_id,
    'seriesProviderId',i.series_id,'rating',COALESCE(i.rating,''),'editing',COALESCE(i.editing,''),'indiciaFrequency',COALESCE(i.indicia_frequency,''),
    'indiciaPublisher','','brandEmblem','','indiciaPrinter','','keywords','',
    'stories',COALESCE(c.data::jsonb->'bibliography'->'stories','[]'::jsonb))))::text AS data,
  CASE WHEN c.data LIKE '%/covers/%' THEN 0 WHEN EXISTS(SELECT 1 FROM gcd.comichuddle_cover_references r WHERE r.issue_id=4000000000::bigint+i.id AND r.status='active') THEN 1 ELSE 2 END AS cover_rank,
  COALESCE(i.modified,i.created,'') AS fetched_at,'{"provider":"GCD","metadataScope":"native_snapshot"}'::text AS raw_metadata
 FROM gcd.gcd_issue i JOIN gcd.gcd_series s ON s.id=i.series_id LEFT JOIN gcd.gcd_publisher p ON p.id=s.publisher_id
 LEFT JOIN ch_web.catalog_issues c ON c.gcd_id=i.id
 CROSS JOIN LATERAL(SELECT CASE WHEN i.key_date ~ '^[0-9]{4}-' THEN substring(i.key_date,1,4)::integer ELSE 0 END AS year)y
 WHERE COALESCE(i.deleted,0)=0 AND COALESCE(s.deleted,0)=0
 UNION ALL
 SELECT c.id,c.gcd_id,c.metron_id,c.title,c.number,c.publisher,c.year::integer,c.era,c.kind,c.search_text,c.data,CASE WHEN c.data LIKE '%/covers/%' THEN 0 WHEN EXISTS(SELECT 1 FROM gcd.comichuddle_cover_references r WHERE r.issue_id=c.id AND r.status='active') THEN 1 ELSE 2 END,c.fetched_at,c.raw_metadata
 FROM ch_web.catalog_issues c LEFT JOIN gcd.gcd_issue native ON native.id=c.gcd_id WHERE c.gcd_id IS NULL OR native.id IS NULL;
COMMENT ON VIEW gcd.comichuddle_directory IS 'Live normalized GCD read view. App IDs remain 4,000,000,000 + GCD ID. Original publisher face prices are not FMV. Artwork not included in snapshot license.';
