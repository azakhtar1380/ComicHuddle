import type {PGlite} from '@electric-sql/pglite';
export async function nativeGcdFixture(engine:PGlite){await engine.exec(`CREATE SCHEMA gcd;
 CREATE TABLE gcd.gcd_publisher(id integer,name text,deleted integer);
 CREATE TABLE gcd.gcd_series(id integer,name text,publisher_id integer,deleted integer);
 CREATE TABLE gcd.gcd_issue(id integer,series_id integer,number text,publication_date text,key_date text,on_sale_date text,price text,page_count numeric,isbn text,barcode text,title text,volume text,variant_of_id integer,variant_name text,rating text,editing text,indicia_frequency text,notes text,created text,modified text,deleted integer);
 `)}
