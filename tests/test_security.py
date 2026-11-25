"""Security checks (2026-11-24): key from #k= (old ?k= rewritten), key never in a request URL, POST bootstrap,
person mismatch refused, no referrer, scanner served from vendor/ (no CDN), no HAE copy button.
Usage: python3 -I tests/test_security.py <repo>"""
import json, sys, os, re, datetime
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'test_sync.py')).read()
exec(src[:src.index('\nfails = []')])   # FOODS, boot(), API, the stubbed handle() and the local server

fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

KEY = 'k3ysecret123'
def run(pw, w, h, tag):
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome',
                            args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    ctx = br.new_context(viewport={'width': w, 'height': h}, timezone_id='America/New_York')
    ctx.grant_permissions(['camera'])
    page = ctx.new_page(); errs = []; reqs = []; posts = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('request', lambda r: (reqs.append(r.url), posts.append(r.post_data or '') if r.method == 'POST' else None))
    page.route(API + '*', handle)

    # 1. new #k= link: key saved, kept in the hash (Safari), never in a request URL, bootstrap is a POST with the key
    page.goto(f'http://127.0.0.1:8765/josh/#k={KEY}'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(800)
    check(page.evaluate("location.hash") == f'#k={KEY}', f'{tag}: #k kept in Safari address')
    check(not any(KEY in u for u in reqs), f'{tag}: key never in a request URL')
    check(any('"bootstrap"' in p and KEY in p for p in posts), f'{tag}: bootstrap POST carries the key')
    check(page.evaluate("document.querySelector('meta[name=referrer]').content") == 'no-referrer', f'{tag}: no-referrer meta')

    # 2. Apple Watch card has no copy button
    page.click('nav.tabs [data-view=prefs]'); page.wait_for_timeout(300)
    check(page.locator('[data-act=haeurl]').count() == 0, f'{tag}: no HAE copy button')
    page.click('nav.tabs [data-view=day]'); page.wait_for_timeout(200)

    # 3. scanner loads from vendor/, nothing from a CDN
    page.locator('[data-addslot]').first.click(); page.wait_for_timeout(300)
    page.locator('[data-m=scan]').first.click(); page.wait_for_timeout(2500)
    check(any(u.endswith('/vendor/zxing-wasm-3.1.7/reader.js') for u in reqs), f'{tag}: reader.js from vendor')
    check(any(u.endswith('/vendor/zxing-wasm-3.1.7/zxing_reader.wasm') for u in reqs), f'{tag}: wasm from vendor')
    check(not any(re.search(r'jsdelivr|unpkg|cdnjs', u) for u in reqs), f'{tag}: no CDN requests')
    check(not errs, f'{tag}: no page errors {errs}')
    ctx.close()

    # 4. old ?k= link still works and is rewritten to #k=
    ctx = br.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); reqs.clear()
    page.on('request', lambda r: reqs.append(r.url)); page.route(API + '*', handle)
    page.goto('http://127.0.0.1:8765/josh/?k=oldkey'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(600)
    check(page.evaluate("location.search") == '' and page.evaluate("location.hash") == '#k=oldkey', f'{tag}: ?k rewritten to #k')
    check(not any('oldkey' in u for u in reqs[1:]), f'{tag}: old key not in later request URLs')
    ctx.close()

    # 5. key that belongs to the other person: refused, nothing shown as hers
    ctx = br.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page()
    def other(route, request):
        b = json.loads(request.post_data or '{}') if request.method == 'POST' else {}
        if b.get('action') == 'bootstrap':
            d = boot('Josh'); d['person'] = 'Josh'
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(d))
        return handle(route, request)
    page.route(API + '*', other)
    page.goto(f'http://127.0.0.1:8765/michelle/#k={KEY}'); page.wait_for_timeout(1500)
    check('belongs to Josh' in page.inner_text('body'), f'{tag}: mismatch message on Michelle page')
    check(page.locator('nav.tabs').count() == 0, f'{tag}: Josh data not shown on Michelle page')
    ctx.close(); br.close()

with sync_playwright() as pw:
    run(pw, 390, 844, 'phone'); run(pw, 820, 1180, 'ipad')
print('\nFAILURES:', len(fails)); [print(' -', f) for f in fails]
srv.shutdown(); sys.exit(1 if fails else 0)
