#!/usr/bin/env python3
"""Independent actual SQLite -> operator JSONL tests; synthetic archives only."""
import hashlib
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('gcd_sqlite_adapter', ROOT / 'scripts/gcd_sqlite_to_jsonl.py')
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)
STAMP = '2026-10-01T12:00:00Z'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SQLiteArchiveAdapter(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='comichuddle-sqlite-qa-')
        self.folder = Path(self.temporary.name)
        self.archive = self.folder / 'licensed-fixture.sqlite'
        self.output = self.folder / 'issues.jsonl'
        self.report = self.folder / 'report.json'
        with sqlite3.connect(self.archive) as db:
            db.executescript('''
              CREATE TABLE gcd_publisher(id INTEGER PRIMARY KEY,name TEXT);
              CREATE TABLE gcd_series(id INTEGER PRIMARY KEY,name TEXT,year_began INTEGER,publisher_id INTEGER);
              CREATE TABLE gcd_indicia_publisher(id INTEGER PRIMARY KEY,name TEXT);
              CREATE TABLE gcd_issue(id INTEGER PRIMARY KEY,number TEXT,series_id INTEGER,deleted BOOLEAN,
                indicia_publisher_id INTEGER,variant_of_id INTEGER,variant_name TEXT,title TEXT,volume TEXT,
                publication_date TEXT,key_date TEXT,price TEXT,page_count DECIMAL,editing TEXT,isbn TEXT,
                barcode TEXT,rating TEXT,on_sale_date TEXT,indicia_frequency TEXT,notes TEXT,
                cover_image TEXT,fmv_cents INTEGER,owner_email TEXT);
              CREATE TABLE gcd_story_type(id INTEGER PRIMARY KEY,name TEXT);
              CREATE TABLE gcd_story(id INTEGER PRIMARY KEY,issue_id INTEGER,sequence_number DECIMAL,
                type_id INTEGER,deleted BOOLEAN,title TEXT,feature TEXT,page_count DECIMAL,
                script TEXT,pencils TEXT,inks TEXT,colors TEXT,letters TEXT,editing TEXT,job_number TEXT,
                genre TEXT,first_line TEXT,characters TEXT,synopsis TEXT,notes TEXT);
              CREATE TABLE gcd_story_credit(id INTEGER PRIMARY KEY,story_id INTEGER);
              CREATE TABLE gcd_issue_credit(id INTEGER PRIMARY KEY,issue_id INTEGER);
              CREATE TABLE gcd_story_character(id INTEGER PRIMARY KEY,story_id INTEGER);
              CREATE TABLE gcd_issue_brand_emblem(id INTEGER PRIMARY KEY,issue_id INTEGER);
              CREATE TABLE gcd_issue_indicia_printer(id INTEGER PRIMARY KEY,issue_id INTEGER);
              CREATE TABLE taggit_taggeditem(id INTEGER PRIMARY KEY,object_id INTEGER);
              INSERT INTO gcd_publisher VALUES(20,'Fixture Press');
              INSERT INTO gcd_series VALUES(30,'Fixture Series',1998,20);
              INSERT INTO gcd_indicia_publisher VALUES(21,'Fixture Indicia LLC');
              INSERT INTO gcd_story_type VALUES(40,'comic story');
              INSERT INTO gcd_issue(id,number,series_id,deleted,indicia_publisher_id,variant_of_id,
                variant_name,title,volume,publication_date,key_date,price,page_count,editing,isbn,
                barcode,rating,on_sale_date,indicia_frequency,notes,cover_image,fmv_cents,owner_email)
              VALUES(101,'1',30,0,21,NULL,'','A bibliographic issue', '2','October 1998','1998-10-00',
                '2.95 USD',32,'Issue Editor','9781234567897','12345','All ages','1998-09-15','monthly',
                'Issue note','https://unlicensed.example/cover.jpg',999999,'PRIVATE_SENTINEL');
              INSERT INTO gcd_issue(id,number,series_id,deleted,variant_of_id,variant_name,key_date)
              VALUES(102,'1B',30,0,101,'Variant B','1998-10-00'),(103,'2',30,1,NULL,'','1998-11-00');
              INSERT INTO gcd_story VALUES(1,101,0,40,0,'Opening story','Feature A',8,
                'Writer Name','Pencil Name','Ink Name','Color Name','Letter Name','Story Editor',
                'JOB-42','Adventure','Opening words','Hero; Sidekick','Story synopsis','Story note');
              INSERT INTO gcd_story VALUES(2,101,1,40,1,'DELETED_STORY','','','','','','','','','','','','','DELETED_TEXT','');
              INSERT INTO gcd_story_credit VALUES(1,1),(2,1);
              INSERT INTO gcd_issue_credit VALUES(1,101);
              INSERT INTO gcd_story_character VALUES(1,1);
              INSERT INTO gcd_issue_brand_emblem VALUES(1,101);
              INSERT INTO gcd_issue_indicia_printer VALUES(1,101);
              INSERT INTO taggit_taggeditem VALUES(1,101);
            ''')

    def tearDown(self):
        self.temporary.cleanup()

    def mutate(self, sql, values=()):
        with sqlite3.connect(self.archive) as db:
            db.execute(sql, values)

    def convert(self, **kwargs):
        result = ADAPTER.convert(self.archive, self.output, self.report, kwargs.pop('snapshot_at', STAMP), **kwargs)
        rows = [json.loads(line) for line in self.output.read_text().splitlines()]
        self.assertEqual(result, json.loads(self.report.read_text()))
        return result, rows

    def rejected(self, **kwargs):
        before = sha(self.archive)
        with self.assertRaises(ADAPTER.ArchiveError):
            ADAPTER.convert(self.archive, self.output, self.report, kwargs.pop('snapshot_at', STAMP), **kwargs)
        self.assertEqual(sha(self.archive), before)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())
        self.assertFalse(self.output.with_name(self.output.name + '.partial').exists())
        self.assertFalse(self.report.with_name(self.report.name + '.partial').exists())

    def test_full_readonly_core_identity_and_bibliography(self):
        before, stat = sha(self.archive), self.archive.stat()
        result, rows = self.convert()
        self.assertEqual([row['api_url'] for row in rows], ['https://www.comics.org/api/issue/101/', 'https://www.comics.org/api/issue/102/'])
        self.assertEqual(rows[0]['series'], 'https://www.comics.org/api/series/30/')
        self.assertEqual(rows[0]['series_name'], 'Fixture Series (1998 series)')
        self.assertEqual(rows[0]['publisher_name'], 'Fixture Press')
        self.assertEqual(rows[0]['indicia_publisher'], 'Fixture Indicia LLC')
        self.assertEqual(rows[0]['price'], '2.95 USD')
        self.assertEqual(rows[0]['page_count'], '32')
        self.assertEqual(rows[0]['isbn'], '9781234567897')
        self.assertEqual(rows[0]['publication_date'], 'October 1998')
        self.assertEqual(rows[0]['on_sale_date'], '1998-09-15')
        self.assertEqual(rows[1]['variant_of'], 'https://www.comics.org/api/issue/101/')
        self.assertEqual(rows[1]['variant_name'], 'Variant B')
        self.assertEqual(result['activeIssueCount'], 2)
        self.assertEqual(result['exportedIssueCount'], 2)
        self.assertTrue(result['allActiveIssueIdentitiesExported'])
        self.assertEqual(result['inputSha256'], before)
        self.assertEqual(result['outputSha256'], sha(self.output))
        self.assertEqual(sha(self.archive), before)
        self.assertEqual(self.archive.stat().st_mtime_ns, stat.st_mtime_ns)
        self.assertFalse(result['inputModified'])

    def test_deleted_stories_and_nonbibliographic_data_never_export(self):
        result, rows = self.convert()
        self.assertEqual(len(rows[0]['story_set']), 1)
        story = rows[0]['story_set'][0]
        self.assertEqual(story['type'], 'comic story')
        self.assertEqual(story['script'], 'Writer Name')
        self.assertEqual(story['characters'], 'Hero; Sidekick')
        self.assertEqual(story['synopsis'], 'Story synopsis')
        for private in ['DELETED_STORY', 'DELETED_TEXT', 'unlicensed.example', 'PRIVATE_SENTINEL', '999999', 'cover_image', 'fmv_cents', 'owner_email']:
            self.assertNotIn(private, self.output.read_text())
        self.assertFalse(result['allBibliographicFieldsExported'])
        self.assertFalse(result['fullHistoricalCoverageClaimed'])
        self.assertEqual(result['upstreamRequests'], 0)
        self.assertEqual(result['license'], 'https://creativecommons.org/licenses/by-sa/4.0/')
        self.assertEqual(result['unmappedLinkedTableCounts'], {
            'gcd_story_credit': 2, 'gcd_issue_credit': 1, 'gcd_story_character': 1,
            'gcd_issue_brand_emblem': 1, 'gcd_issue_indicia_printer': 1, 'taggit_taggeditem': 1})

    def test_legacy_story_order_and_one_hundred_cap_are_reported(self):
        with sqlite3.connect(self.archive) as db:
            db.executemany('INSERT INTO gcd_story(id,issue_id,sequence_number,type_id,deleted,title) VALUES(?,101,?,40,0,?)',
                           [(1000 + index, index, 'Sequence ' + str(index)) for index in range(110, 0, -1)])
        result, rows = self.convert()
        self.assertEqual(len(rows[0]['story_set']), 100)
        self.assertEqual(rows[0]['story_set'][0]['title'], 'Opening story')
        self.assertEqual(rows[0]['story_set'][-1]['title'], 'Sequence 99')
        self.assertEqual(result['storySequencesCappedAt100'], 1)
        self.assertFalse(result['allBibliographicFieldsExported'])

    def test_explicit_partial_limit_preserves_total_coverage_and_rejects_bad_limits(self):
        for limit in [0, -1, True, 1.5]:
            with self.subTest(limit=limit):
                self.rejected(limit=limit)
        result, rows = self.convert(limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(result['activeIssueCount'], 2)
        self.assertEqual(result['exportedIssueCount'], 1)
        self.assertFalse(result['allActiveIssueIdentitiesExported'])
        self.assertFalse(result['fullHistoricalCoverageClaimed'])

    def test_invalid_issue_series_variant_and_missing_join_fail_without_outputs(self):
        for sql, values in [
            ('UPDATE gcd_issue SET id=? WHERE id=102', (2_147_483_648,)),
            ('UPDATE gcd_issue SET series_id=? WHERE id=102', (0,)),
            ('UPDATE gcd_issue SET variant_of_id=? WHERE id=102', (-1,)),
            ('UPDATE gcd_series SET publisher_id=999', ()),
        ]:
            with self.subTest(sql=sql):
                backup = self.archive.read_bytes()
                self.mutate(sql, values)
                self.rejected()
                self.archive.write_bytes(backup)

    def test_record_byte_limit_rolls_back_an_already_written_first_record(self):
        with sqlite3.connect(self.archive) as db:
            db.executemany('INSERT INTO gcd_story(id,issue_id,sequence_number,type_id,deleted,synopsis,notes) VALUES(?,102,?,40,0,?,?)',
                           [(1000 + index, index, '界' * 6000, '界' * 6000) for index in range(20)])
        self.rejected()

    def test_missing_required_columns_and_no_active_issues_fail_closed(self):
        for sql in ['ALTER TABLE gcd_series DROP COLUMN publisher_id', 'DELETE FROM gcd_issue']:
            with self.subTest(sql=sql):
                backup = self.archive.read_bytes()
                self.mutate(sql)
                self.rejected()
                self.archive.write_bytes(backup)

    def test_views_cannot_substitute_required_archive_tables(self):
        with sqlite3.connect(self.archive) as db:
            db.executescript('ALTER TABLE gcd_issue RENAME TO actual_issue; CREATE VIEW gcd_issue AS SELECT * FROM actual_issue;')
        self.rejected()

    def test_existing_outputs_distinct_paths_and_partial_files_are_preserved(self):
        before = sha(self.archive)
        for target in [self.output, self.report, self.output.with_name('issues.jsonl.partial'), self.report.with_name('report.json.partial')]:
            with self.subTest(target=target.name):
                target.write_bytes(b'EXISTING_OUTPUT_SENTINEL')
                with self.assertRaises((ADAPTER.ArchiveError, FileExistsError)):
                    ADAPTER.convert(self.archive, self.output, self.report, STAMP)
                self.assertEqual(target.read_bytes(), b'EXISTING_OUTPUT_SENTINEL')
                for path in [self.output, self.report, self.output.with_name('issues.jsonl.partial'), self.report.with_name('report.json.partial')]:
                    if path != target:
                        self.assertFalse(path.exists())
                target.unlink()
        with self.assertRaises(ADAPTER.ArchiveError):
            ADAPTER.convert(self.archive, self.archive, self.report, STAMP)
        with self.assertRaises(ADAPTER.ArchiveError):
            ADAPTER.convert(self.archive, self.output, self.output, STAMP)
        self.assertEqual(sha(self.archive), before)

    def test_optional_fields_stay_explicitly_unmapped(self):
        with sqlite3.connect(self.archive) as db:
            db.executescript('ALTER TABLE gcd_issue DROP COLUMN rating; ALTER TABLE gcd_story DROP COLUMN job_number; DROP TABLE gcd_story_credit;')
        result, rows = self.convert()
        self.assertEqual(rows[0]['rating'], '')
        self.assertIn('rating', result['missingOptionalIssueFields'])
        self.assertIn('job_number', result['missingOptionalLegacyStoryFields'])
        self.assertNotIn('gcd_story_credit', result['unmappedLinkedTableCounts'])
        self.assertFalse(result['allBibliographicFieldsExported'])

    def test_archive_timestamp_must_be_real_timezone_and_not_future(self):
        for stamp in ['not-a-date', '2026-10-01T12:00:00', '2999-01-01T00:00:00Z']:
            with self.subTest(stamp=stamp):
                self.rejected(snapshot_at=stamp)
        result, _ = self.convert(snapshot_at='2026-10-01T14:00:00+02:00')
        self.assertEqual(dt.datetime.fromisoformat(result['snapshotAt'].replace('Z', '+00:00')),
                         dt.datetime.fromisoformat(STAMP.replace('Z', '+00:00')))

    def test_real_cli_emits_report_and_failure_preserves_previous_artifacts(self):
        command = [sys.executable, str(ROOT / 'scripts/gcd_sqlite_to_jsonl.py'), '--input', str(self.archive),
                   '--output', str(self.output), '--report', str(self.report), '--snapshot-at', STAMP]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), json.loads(self.report.read_text()))
        output, report = self.output.read_bytes(), self.report.read_bytes()
        again = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(again.returncode, 1)
        self.assertEqual(json.loads(again.stdout)['outcome'], 'export-not-published')
        self.assertEqual(self.output.read_bytes(), output)
        self.assertEqual(self.report.read_bytes(), report)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SQLiteArchiveAdapter))
    print('QA_RESULT ' + json.dumps({'suite': 'GCD SQLite archive adapter', 'passed': result.testsRun - len(result.failures) - len(result.errors),
          'failed': len(result.failures) + len(result.errors), 'syntheticArchive': True, 'genuineProviderRequests': 0,
          'completeGcdArchiveAvailable': False}))
    sys.exit(0 if result.wasSuccessful() else 1)
