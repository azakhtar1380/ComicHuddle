#!/usr/bin/env python3
"""Convert an authorized GCD SQLite archive to reviewed bibliographic JSONL.

No downloading, artwork, valuations or credential handling. The input is opened
read-only. This adapter maps issue identities/core bibliography/legacy story
text, not Django's rendered modern linked credits, tags, brands or characters.
Its report explicitly distinguishes issue coverage from field completeness.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import re

ORIGIN = 'https://www.comics.org'
LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/'
ID_MAX = 2_147_483_647
RECORD_BYTES = 180_000
MODEL_SOURCES = [
    'https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/gcd/models/issue.py',
    'https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/gcd/models/series.py',
    'https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/gcd/models/publisher.py',
    'https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/gcd/models/story.py',
    'https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/api/serializers.py',
]
ISSUE_FIELDS = {'volume':80,'variant_name':160,'title':1000,'publication_date':160,
    'key_date':40,'price':400,'page_count':80,'editing':2000,'isbn':80,
    'barcode':120,'rating':500,'on_sale_date':40,'indicia_frequency':200,'notes':6000}
STORY_FIELDS = {'title':1000,'feature':1000,'page_count':80,'script':2000,
    'pencils':2000,'inks':2000,'colors':2000,'letters':2000,'editing':2000,
    'job_number':300,'genre':1000,'first_line':2000,'characters':2000,
    'synopsis':6000,'notes':6000}

class ArchiveError(ValueError):
    pass

def source_time(value: str) -> str:
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError as error:
        raise ArchiveError('Use the actual archive timestamp in ISO 8601 format.') from error
    if parsed.tzinfo is None or parsed > dt.datetime.now(dt.timezone.utc):
        raise ArchiveError('Archive timestamp must include a timezone and cannot be in the future.')
    return parsed.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def identity(value, label: str) -> int:
    if not isinstance(value,int) or isinstance(value,bool) or not 1<=value<=ID_MAX:
        raise ArchiveError('Invalid '+label+' provider identity.')
    return value

def digest(path: Path) -> str:
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024*1024),b''):
            result.update(chunk)
    return result.hexdigest()

def columns(db: sqlite3.Connection, table: str, required=()) -> set[str]:
    row=db.execute('SELECT type,sql FROM sqlite_master WHERE name=?',(table,)).fetchone()
    if not row or row[0]!='table' or 'VIRTUAL TABLE' in (row[1] or '').upper():
        if required:
            raise ArchiveError('A supported ordinary '+table+' table is required.')
        return set()
    actual={row[1] for row in db.execute('PRAGMA table_info("'+table+'")')}
    if not set(required)<=actual:
        raise ArchiveError(table+' is missing required columns: '+', '.join(sorted(set(required)-actual)))
    return actual

def projected(prefix: str, available: set[str], fields: dict[str,int]) -> str:
    # Fixed field names only; never execute a downloaded SQL dump.
    return ','.join('substr(CAST('+prefix+'."'+key+'" AS TEXT),1,'+str(cap)+') AS "'+key+'"'
        if key in available else 'NULL AS "'+key+'"' for key,cap in fields.items())

def convert(input_path: Path, output_path: Path, report_path: Path,
            snapshot_at: str, *, limit: int|None=None, include_cover_references: bool=False,
            cover_origin: str='https://files1.comics.org') -> dict:
    input_path=input_path.resolve(strict=True)
    output_path=output_path.resolve();report_path=report_path.resolve()
    if not input_path.is_file() or input_path.stat().st_size>100*1024**3:
        raise ArchiveError('Provide an extracted ordinary SQLite file no larger than 100 GiB.')
    if include_cover_references and not re.fullmatch(r'https://files[0-9]+\.comics\.org', cover_origin):
        raise ArchiveError('Use the HTTPS GCD image origin actually observed in its API.')
    if len({input_path,output_path,report_path})!=3 or output_path.exists() or report_path.exists():
        raise ArchiveError('Use distinct new output/report paths; existing files are preserved.')
    if limit is not None and (not isinstance(limit,int) or isinstance(limit,bool) or limit<1):
        raise ArchiveError('Limit must be a positive number; omit it for every active issue.')
    snapshot_at=source_time(snapshot_at)
    before_stat=input_path.stat()
    input_sha=digest(input_path)
    db=sqlite3.connect(input_path.as_uri()+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF')
    db.execute('BEGIN')
    temporary=output_path.with_name(output_path.name+'.partial')
    report_temporary=report_path.with_name(report_path.name+'.partial')
    created_temporary=False;created_report_temporary=False
    try:
        ic=columns(db,'gcd_issue',('id','number','series_id','deleted'))
        sc=columns(db,'gcd_series',('id','name','year_began','publisher_id'))
        pc=columns(db,'gcd_publisher',('id','name'))
        ip=columns(db,'gcd_indicia_publisher',('id','name')) if 'indicia_publisher_id' in ic else set()
        stories=columns(db,'gcd_story',('id','issue_id','sequence_number','type_id','deleted'))
        story_types=columns(db,'gcd_story_type',('id','name')) if stories else set()
        cover_columns=columns(db,'gcd_cover') if include_cover_references else set()
        if cover_columns and not {'id','issue_id','deleted'}<=cover_columns:
            raise ArchiveError('Unsupported gcd_cover schema; image IDs cannot be guessed.')
        cover_query=None
        if cover_columns:
            cover_fields=projected('c',cover_columns,{'is_wraparound':8,'last_upload':50,'modified':50})
            cover_query='SELECT c.id,'+cover_fields+' FROM gcd_cover c WHERE c.issue_id=? AND c.deleted=0'
            if 'limit_display' in cover_columns: cover_query+=' AND c.limit_display=0'
            cover_query+=' ORDER BY c.id LIMIT 1'
        total=db.execute('SELECT count(*) FROM gcd_issue WHERE deleted=0').fetchone()[0]
        if not total:
            raise ArchiveError('The archive contains no active GCD issues.')
        missing_issue_fields=sorted(set(ISSUE_FIELDS)-ic)
        missing_story_fields=sorted(set(STORY_FIELDS)-stories) if stories else sorted(STORY_FIELDS)
        linked_tables=['gcd_story_credit','gcd_issue_credit','gcd_story_character',
            'gcd_issue_brand_emblem','gcd_issue_indicia_printer','taggit_taggeditem']
        unmapped={table:db.execute('SELECT count(*) FROM "'+table+'"').fetchone()[0]
            for table in linked_tables if columns(db,table)}
        indicia_select='substr(ip.name,1,160)' if ip else 'NULL'
        indicia_join=' LEFT JOIN gcd_indicia_publisher ip ON ip.id=i.indicia_publisher_id' if ip else ''
        variant_select='i.variant_of_id' if 'variant_of_id' in ic else 'NULL'
        query=('SELECT i.id,i.series_id,substr(CAST(i.number AS TEXT),1,40) AS number,'
            'substr(s.name,1,130) AS series_name,s.year_began,'
            'substr(p.name,1,160) AS publisher_name,'+indicia_select+' AS indicia_publisher,'
            +variant_select+' AS variant_of_id,'+projected('i',ic,ISSUE_FIELDS)+
            ' FROM gcd_issue i LEFT JOIN gcd_series s ON s.id=i.series_id'
            ' LEFT JOIN gcd_publisher p ON p.id=s.publisher_id'+indicia_join+
            ' WHERE i.deleted=0 AND i.id>? ORDER BY i.id LIMIT 512')
        story_query=('SELECT st.id,st.sequence_number,substr(t.name,1,200) AS type,'
            +projected('st',stories,STORY_FIELDS)+
            ' FROM gcd_story st LEFT JOIN gcd_story_type t ON t.id=st.type_id'
            ' WHERE st.deleted=0 AND st.issue_id=? ORDER BY st.sequence_number,st.id LIMIT 101') if stories else None
        output_path.parent.mkdir(parents=True,exist_ok=True)
        report_path.parent.mkdir(parents=True,exist_ok=True)
        count=0;last_id=0;shortened_story_issues=0;cover_count=0;output_sha=hashlib.sha256()
        with temporary.open('xb') as stream:
            created_temporary=True
            while limit is None or count<limit:
                batch=db.execute(query,(last_id,)).fetchall()
                if not batch:break
                for row in batch:
                    if limit is not None and count>=limit:break
                    issue_id=identity(row['id'],'issue');series_id=identity(row['series_id'],'series')
                    if issue_id<=last_id or not row['series_name'] or not row['number'] or not row['publisher_name']:
                        raise ArchiveError('Issue '+str(issue_id)+' has incomplete or unordered directory identity.')
                    raw={key:row[key] or '' for key in ISSUE_FIELDS}
                    series_label=row['series_name']
                    if isinstance(row['year_began'],int):
                        series_label+=' ('+str(row['year_began'])+' series)'
                    raw.update(api_url=ORIGIN+'/api/issue/'+str(issue_id)+'/',
                        series=ORIGIN+'/api/series/'+str(series_id)+'/',series_name=series_label,
                        number=row['number'],publisher_name=row['publisher_name'],
                        indicia_publisher=row['indicia_publisher'] or '',descriptor=row['number'],
                        variant_of=(ORIGIN+'/api/issue/'+str(identity(row['variant_of_id'],'variant'))+'/'
                            if row['variant_of_id'] is not None else None),story_set=[])
                    if story_query:
                        sequence=db.execute(story_query,(issue_id,)).fetchall()
                        if len(sequence)>100:shortened_story_issues+=1
                        for story in sequence[:100]:
                            facts={key:story[key] or '' for key in STORY_FIELDS}
                            facts.update(type=story['type'] or '',sequence_number=story['sequence_number'],keywords='')
                            raw['story_set'].append(facts)
                    if include_cover_references:
                        raw['cover']=''
                        raw['cover_metadata']=None
                        # Never borrow the parent/base cover for a variant.
                        cover=db.execute(cover_query,(issue_id,)).fetchone() if cover_query else None
                        if cover:
                            cover_id=identity(cover['id'],'cover')
                            raw['cover']=cover_origin+'/img/gcd/covers_by_id/'+str(cover_id//1000)+'/w400/'+str(cover_id)+'.jpg'
                            raw['cover_metadata']={'coverId':cover_id,'issueId':issue_id,
                                'isWraparound':cover['is_wraparound']=='1',
                                'lastUpload':cover['last_upload'] or None,'modified':cover['modified'] or None,
                                'thumbnailWidth':400,'mimeType':'image/jpeg','sourceTable':'gcd_cover',
                                'artworkBinariesCopied':False}
                            cover_count+=1
                    encoded=json.dumps(raw,ensure_ascii=False,separators=(',',':')).encode('utf-8')
                    if len(encoded)>RECORD_BYTES:
                        raise ArchiveError('Issue '+str(issue_id)+' exceeds the reviewed record bound; export not published.')
                    line=encoded+b'\n';stream.write(line);output_sha.update(line)
                    count+=1;last_id=issue_id
        after_stat=input_path.stat()
        if (before_stat.st_size,before_stat.st_mtime_ns)!=(after_stat.st_size,after_stat.st_mtime_ns):
            raise ArchiveError('The input archive changed during conversion; keep it immutable and retry.')
        if limit is None and count!=total:
            raise ArchiveError('Active issue count did not reconcile; export not published.')
        report={'format':'GCD_API_SHAPED_JSONL','source':'GCD licensed SQLite archive supplied by operator',
            'sourceUrl':ORIGIN+'/download/','snapshotAt':snapshot_at,'inputSha256':input_sha,
            'outputSha256':output_sha.hexdigest(),'activeIssueCount':total,'exportedIssueCount':count,
            'allActiveIssueIdentitiesExported':count==total,'allBibliographicFieldsExported':False,
            'fullHistoricalCoverageClaimed':False,'license':LICENSE,'modelSources':MODEL_SOURCES,
            'missingOptionalIssueFields':missing_issue_fields,'missingOptionalLegacyStoryFields':missing_story_fields,
            'storySequencesCappedAt100':shortened_story_issues,'unmappedLinkedTableCounts':unmapped,
            'mappingLimitations':['Legacy textual credits/characters/feature only; linked Django display fields are not reconstructed.',
                'Modern linked credits, characters, brands, printers, tags and uncertain date display suffixes require schema-specific enrichment.',
                'Mapped text is bounded as documented; counts are issue coverage, not exact reproduction of all GCD fields.',
                'No artwork binaries, FMV, customer/private tables or deleted issues are exported.'],
            'inputModified':False,'upstreamRequests':0}
        if include_cover_references:
            report.update(coverReferencesIncluded=True,coverReferenceCount=cover_count,
                coverTablePresent=bool(cover_columns),coverOrigin=cover_origin,
                coverMapping='Own nondeleted, unrestricted gcd_cover ID using the published GCD Cover.get_base_url mapping; no issue-ID filename guesses or borrowed variant artwork.',
                artworkBinariesCopied=False,coversLicensedByMetadata=False)
        with report_temporary.open('x',encoding='utf-8') as stream:
            created_report_temporary=True
            stream.write(json.dumps(report,indent=2)+'\n')
        # New outputs only. Hard links publish without overwriting a racing file.
        os.link(temporary,output_path)
        try:os.link(report_temporary,report_path)
        except Exception:
            output_path.unlink();raise
        return report
    finally:
        db.close()
        if created_temporary:temporary.unlink(missing_ok=True)
        if created_report_temporary:report_temporary.unlink(missing_ok=True)

def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--snapshot-at',required=True,help='Actual archive date/time from GCD download page; not conversion time.')
    parser.add_argument('--limit',type=int,help='Explicit partial test export; omit for all active issue identities.')
    parser.add_argument('--include-cover-references',action='store_true',help='Map actual gcd_cover IDs if the archive includes that table; never copy artwork.')
    parser.add_argument('--cover-origin',default='https://files1.comics.org',help='Current HTTPS GCD image origin observed in the official API.')
    args=parser.parse_args()
    try:result=convert(args.input,args.output,args.report,args.snapshot_at,limit=args.limit,
        include_cover_references=args.include_cover_references,cover_origin=args.cover_origin)
    except (ArchiveError,OSError,sqlite3.Error) as error:
        print(json.dumps({'outcome':'export-not-published','error':str(error)}));return 1
    print(json.dumps(result));return 0

if __name__=='__main__':
    sys.exit(main())
