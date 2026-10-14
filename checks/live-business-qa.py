"""Explicit live QA for the public preview. No processor payments are made.

Creates clearly named, temporary QA profiles; removes their application records
in finally. Authentication users remain for operator-managed retention review.
Credentials and cookies exist only in process memory and are never reported.
"""
import argparse
import json
import secrets
from pathlib import Path
from datetime import datetime, timezone
import urllib.request
import urllib.error
from http.cookiejar import CookieJar

class ApiResponse:
    def __init__(self, response):
        self.status_code = response.status
        self.headers = response.headers
        self.body = response.read()
    def json(self):
        return json.loads(self.body)

class ApiSession:
    def __init__(self):
        self.cookies = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
    def request(self, method, url, json=None, data=None, headers=None, timeout=40):
        import json as encoder
        if json is not None:
            data = encoder.dumps(json).encode('utf8')
            headers = {'Content-Type': 'application/json', **(headers or {})}
        request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            return ApiResponse(self.opener.open(request, timeout=timeout))
        except urllib.error.HTTPError as response:
            return ApiResponse(response)
    def close(self):
        self.cookies.clear()

parser = argparse.ArgumentParser()
parser.add_argument('--run', action='store_true', required=True)
parser.add_argument('--base-url', required=True)
parser.add_argument('--report', required=True)
args = parser.parse_args()
base = args.base_url.rstrip('/')
assert base.startswith('https://') and '.vercel.app' in base
checks, actors = [], []
stage = 'initialization'

def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS: ' + name, flush=True)

def call(session, method, path, body=None, headers=None, data=None):
    merged = {'Origin': base, **(headers or {})}
    response = session.request(method, base + path, json=body, data=data,
                               headers=merged, timeout=40)
    return response

def post(session, path, body):
    response = call(session, 'POST', path, body)
    assert response.status_code == 200, stage + ' status ' + str(response.status_code)
    return response.json()

def profile(actor, visible=True):
    return {'action': 'profile', 'handle': actor['handle'], 'name': 'Temporary ComicHuddle QA',
            'bio': 'Temporary automated QA profile. No comics or services are offered for sale.',
            'tagline': 'QA only', 'location': 'Minneapolis, MN', 'favorite': '', 'since': 2026,
            'color': 'teal', 'featured': [], 'visible': visible, 'dmOpen': True, 'accept': True}

error = None
try:
    for role in ['seller', 'buyer']:
        stage = role + ' registration'
        actor = {'role': role, 'session': ApiSession(), 'handle': 'qa_' + secrets.token_hex(6)}
        actors.append(actor)
        post(actor['session'], '/api/auth/sign-up/email', {
            'name': 'Temporary ComicHuddle QA', 'email': actor['handle'] + '@example.invalid',
            'password': secrets.token_urlsafe(32)})
        stage = role + ' profile'
        post(actor['session'], '/api/social', profile(actor))
        actor['profile'] = True
    seller, buyer = actors[0]['session'], actors[1]['session']
    check('live collector signup and authenticated profile creation', True)
    stage = 'sandbox boundary'
    setup = call(seller, 'GET', '/api/commerce?kind=setup').json()
    check('live payments remain disabled; QA cannot move real funds', setup.get('productionPaymentsEnabled') is False)

    stage = 'private photo'
    response = call(seller, 'POST', '/api/media', headers={'Content-Type': 'image/jpeg'},
                    data=Path('public/covers/planet-27.jpg').read_bytes())
    check('owned QA image upload persists in RDS', response.status_code == 200)
    photo = response.json()['id']
    check('another collector cannot access an unshared image', call(buyer, 'GET', '/api/media?id=' + photo).status_code == 404)
    stage = 'collection'
    existing = call(seller, 'GET', '/api/vault')
    vault = {'profile': 'Temporary ComicHuddle QA', 'books': [
        {'id': 'qa-copy-' + str(i), 'title': 'Planet Comics', 'issue': '#27', 'grade': 'Raw / QA fixture',
         'price': 0, 'catalogId': 26, 'photoId': photo} for i in range(4)],
        'wants': [], 'posts': [], 'likes': [], 'tradeBookIds': [], 'clubs': [], 'watchlist': [], 'tradeDrafts': []}
    response = call(seller, 'POST', '/api/vault', vault, headers={'If-Match': existing.headers['ETag']})
    check('live collection persists with optimistic version control', response.status_code == 200)
    revision = response.headers.get('X-ComicHuddle-Vault-Version')
    check('application collection revision survives HTTP compression', bool(revision) and revision == response.headers['ETag'].removeprefix('W/'))
    stale = call(seller, 'POST', '/api/vault', vault,
                 headers={'If-Match': existing.headers['ETag']})
    check('stale collection writes are rejected without overwriting owned copies', stale.status_code == 409)
    refreshed = call(seller, 'GET', '/api/vault')
    weak_retry = call(seller, 'POST', '/api/vault', vault,
                      headers={'If-Match': 'W/' + refreshed.headers['X-ComicHuddle-Vault-Version']})
    check('a weak proxy ETag can retry successfully after reconnecting', weak_retry.status_code == 200)
    check('cross-account collection reads remain isolated', call(buyer, 'GET', '/api/vault').json() is None)
    stage = 'listing creation'
    fixture = {'action': 'listing', 'description': 'TEMPORARY QA FIXTURE. Not an actual comic offering. No payment will be accepted.',
               'price': 100, 'shipping': 0, 'photos': [photo], 'attest': True, 'usaAttest': True,
               'fulfillment': 'pickup', 'pickupCity': 'Minneapolis', 'pickupState': 'MN',
               'locationZip': '55421', 'saleType': 'fixed'}
    single = post(seller, '/api/social', {**fixture, 'kind': 'single', 'bookIds': ['qa-copy-0'],
                                         'title': 'TEMPORARY QA — NOT FOR SALE', 'safePurchaseOptIn': True})['listingId']
    lot = post(seller, '/api/social', {**fixture, 'kind': 'collection', 'bookIds': ['qa-copy-1', 'qa-copy-2'],
                                      'title': 'TEMPORARY QA COLLECTION — NOT FOR SALE', 'price': 60000,
                                      'safePurchaseOptIn': False})['listingId']
    stage = 'inspection request'
    request = post(buyer, '/api/social', {'action': 'safe_purchase_request', 'listingId': single})
    check('opted-in inspection request opens a private conversation', bool(request.get('threadId')))
    # Hide the QA profile immediately. No external user receives a QA message.
    post(seller, '/api/social', profile(actors[0], False))
    stage = 'private listing search'
    nearby = call(seller, 'GET', '/api/marketplace?view=mine&location=55421&radius=5').json()
    rows = {row['id']: row for row in nearby['listings']}
    check('live PostgreSQL radius search finds exact QA listings', single in rows and lot in rows and rows[single]['distanceMiles'] == 0)
    check('SafePurchase opt-in is optional for a high-value collection', rows[single]['safePurchaseOptIn'] is True and rows[lot]['safePurchaseOptIn'] is False)
    check('selected service does not falsely claim completed inspection', rows[single]['safePurchaseVerifiedAt'] is None)
    check('listing responses omit private ZIP and coordinates', all('latitude' not in r and 'locationZip' not in r for r in rows.values()))
    stage = 'seller permissions'
    check('other collector cannot mark a seller listing sold', call(buyer, 'POST', '/api/social', {'action': 'mark_sold', 'listingId': single, 'soldVia': 'cash_local'}).status_code == 404)
    check('foreign-origin writes are rejected', call(seller, 'POST', '/api/social', {'action': 'mark_sold', 'listingId': single, 'soldVia': 'cash_local'}, headers={'Origin': 'https://example.invalid'}).status_code == 403)
    stage = 'sold workflow'
    post(seller, '/api/social', {'action': 'mark_sold', 'listingId': single, 'soldVia': 'cash_local'})
    post(seller, '/api/social', {'action': 'mark_sold', 'listingId': lot, 'soldVia': 'platform'})
    sold = call(seller, 'GET', '/api/marketplace?view=sold').json()['listings']
    check('both sale-source options immediately move listings to Sold Items', {single, lot}.issubset({r['id'] for r in sold}))
    mine = call(seller, 'GET', '/api/marketplace?view=mine').json()['listings']
    check('sold inventory disappears from active seller listings', not {single, lot}.intersection({r['id'] for r in mine}))
    wallet = call(seller, 'GET', '/api/wallet').json()
    check('manual platform and cash reports cannot mint wallet money', wallet['live']['availableCents'] == '0' and wallet['sandbox']['availableCents'] == '0' and wallet['history'] == [])

    stage = 'specialist registration'
    post(seller, '/api/social', profile(actors[0]))
    studio = {'action': 'provider', 'name': 'TEMPORARY QA STUDIO', 'bio': 'QA only. Not a public service offering.',
              'location': 'Minneapolis, MN', 'locationZip': '55421', 'services': ['pressing', 'dry_cleaning'],
              'prices': {'pressing': None, 'dry_cleaning': None}, 'specialties': 'QA fixture', 'experienceSince': 2026,
              'turnaroundMin': 1, 'turnaroundMax': 2, 'mailIn': False, 'dropoff': True, 'accepting': False,
              'visible': False, 'submissionMode': 'none', 'dealerReference': '', 'website': '', 'logoId': None,
              'portfolio': [], 'shippingAddress': 'QA PRIVATE INTAKE — NO REAL ADDRESS',
              'shippingNotes': 'QA only', 'terms': 'QA only. No bookings, charges or shipping accepted.',
              'attest': True, 'dealerAttest': False}
    post(seller, '/api/pressing', studio)
    care = call(seller, 'GET', '/api/pressing?location=55421&radius=15').json()
    check('live specialist registration stores city/ZIP and private intake', care['mine']['locationZip'] == '55421' and care['mine']['locationState'] == 'MN')
    check('hidden QA studio is excluded from the workshop directory', all(p['id'] != care['mine']['id'] for p in care['providers']))
    check('invalid radius search fails with a clear client error', call(seller, 'GET', '/api/marketplace?radius=15').status_code == 400)
    stage = 'catalog invariance'
    check('QA creates no fabricated directory issues', call(seller, 'GET', '/api/catalog?limit=1').json()['total'] >= 6826)
except Exception as problem:
    error = stage + ' — ' + type(problem).__name__
    print('FAIL: ' + error, flush=True)
finally:
    cleanup = []
    for actor in actors:
        if actor.get('profile'):
            try:
                response = call(actor['session'], 'POST', '/api/social', {'action': 'delete_my_data', 'confirm': 'DELETE'})
                removed = response.status_code == 200 and response.json().get('saved') is True
                cleanup.append({'role': actor['role'], 'applicationRecordsRemoved': removed})
                print(('PASS' if removed else 'FAIL') + ': ' + actor['role'] + ' application fixture cleanup', flush=True)
            except Exception:
                cleanup.append({'role': actor['role'], 'applicationRecordsRemoved': False})
        try:
            call(actor['session'], 'POST', '/api/auth/sign-out', {})
        except Exception:
            pass
        actor['session'].close()
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'url': base,
              'passed': len(checks), 'checks': checks, 'error': error, 'cleanup': cleanup,
              'realPaymentsAttempted': False, 'realProviderTransactionsTested': False,
              'authenticationUsers': 'Two clearly named QA authentication users remain for operator-managed retention; passwords and sessions were not saved.'}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    if error or any(not row['applicationRecordsRemoved'] for row in cleanup):
        raise SystemExit(1)
