"""Done-exercise details sheet (stats, records, Workout Buddy sets). Usage: python3 -I test_exdetails.py <repo>"""
import sys, re, json
src = open(__file__.replace('test_exdetails.py', 'test_inbox.py')).read().split('\ndef run(')[0]
exec(src)
ST = D(0).replace('-', '')
TODAY_EX = [dict(date=D(0), name='Bicycling', min=36, cal=223, source='Apple Watch', id=f'AW-{ST}0820'),
            dict(date=D(0), name='Bicycling', min=36, cal=218, source='Apple Watch', id=f'AW-{ST}0936'),
            dict(date=D(0), name='Weight Lifting', min=10, cal=49, source='Apple Watch', id=f'AW-{ST}1319')]
HIST = [dict(date=D(-d), name='Bicycling', min=30, cal=200, source='Apple Watch', id=f'AWH{d}') for d in range(2, 40, 3)]
_boot = boot
def boot(person):
    b = _boot(person); b['exercise'] = HIST + TODAY_EX; return b
SETS = [dict(Date=D(0), Exercise='Single Arm Row', Set=s, Side=side, **{'Weight (lb)': 20, 'Reps': r, 'Session ID': f'{D(0)}-1319'}) for s, side, r in [(1, 'Right', 12), (1, 'Left', 12), (2, 'Right', 16), (2, 'Left', 16)]] + \
       [dict(Date=D(-5), Exercise='Single Arm Row', Set=1, Side='Right', **{'Weight (lb)': 20, 'Reps': 14, 'Session ID': f'{D(-5)}-0900'})] + \
       [dict(Date=D(0), Exercise='Squats', Set=1, Side='Both', **{'Weight (lb)': 25, 'Reps': 12, 'Session ID': f'{D(0)}-1700'})]
def handle2(route, request):
    if request.method == 'POST':
        body = json.loads(request.post_data or '{}')
        if body.get('action') == 'readWB':
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'rows': SETS}))
        if body.get('action') == 'read' and body.get('tab') == 'Exercise':
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'rows': [dict(EntryID=x['id'], Planned='No') for x in TODAY_EX]}))
    return handle(route, request)
with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for w, h, tag in [(390, 844, 'phone'), (820, 1180, 'ipad')]:
        ctx = br.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route(API + '*', handle2); page.route(re.compile(r'.*cdn\.jsdelivr.*'), lambda r, q: r.abort())
        page.goto('http://127.0.0.1:8765/josh/?k=test'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(900)
        page.locator('[data-ex]', has_text='Bicycling').nth(1).click(); page.wait_for_selector('.ex-details')
        t = page.locator('.sheet').inner_text()
        check('9:36' in t and '10:12' in t, f'{tag}: ride time range')
        check('Your usual bicycling: 30 min' in t, f'{tag}: usual comparison')
        check('2nd bicycling of the day' in t, f'{tag}: 2nd of day')
        page.evaluate("document.querySelector('[data-m=close]').click()"); page.wait_for_timeout(200)
        page.locator('[data-ex]', has_text='Bicycling').nth(0).click(); page.wait_for_selector('.ex-details')
        t = page.locator('.sheet').inner_text()
        check('Most calories for bicycling in a year' in t and 'Longest bicycling in a year' in t, f'{tag}: records on first ride')
        page.screenshot(path=f'/tmp/exd_{tag}_ride.png')
        page.evaluate("document.querySelector('[data-m=close]').click()"); page.wait_for_timeout(200)
        page.locator('[data-ex]', has_text='Weight Lifting').click(); page.wait_for_selector('.lift-row'); page.wait_for_timeout(200)
        t = page.locator('.sheet').inner_text()
        check('Single Arm Row' in t and 'Squats' not in t, f'{tag}: only the matching session')
        check('20×12R' in t and '4 sets' in t and '56 reps' in t, f'{tag}: sets summary')
        check('16 reps at 20 lb, a new best' in t, f'{tag}: rep PR')
        page.screenshot(path=f'/tmp/exd_{tag}_lift.png')
        check(not errs, f'{tag}: no errors {errs[:1]}')
        ctx.close()
    br.close()
srv.shutdown()
print('FAILS:', fails) if fails else print('ALL PASS')
