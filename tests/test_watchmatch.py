"""Planned exercise hidden once an unhandled Apple Watch workout replaces it. Usage: python3 -I test_watchmatch.py <repo>"""
import sys, re, json
src = open(__file__.replace('test_watchmatch.py', 'test_inbox.py')).read().split('\ndef run(')[0]
exec(src)
CASES = {
  'one':  [dict(id='AW-1', min=36, cal=218, planned=None)],
  'two':  [dict(id='AW-1', min=36, cal=218, planned=None), dict(id='AW-2', min=25, cal=140, planned=None)],
  'handled': [dict(id='AW-1', min=36, cal=218, planned='No')],
  'short_first': [dict(id='AW-1', min=24, cal=130, planned=None)],
}
CUR = ['one']
PLANS_EX = [dict(date=D(0), name='Bicycling', min=48, cal=249, source='Plan', id='XP48'), dict(date=D(0), name='Bicycling', min=23, cal=119, source='Plan', id='XP23'), dict(date=D(0), name='Walking', min=20, cal=86, source='Plan', id='XPW')]
def watch(): return [dict(date=D(0), name='Bicycling', min=w['min'], cal=w['cal'], source='Apple Watch', id=f"AW-2026{w['id']}") for w in CASES[CUR[0]]]
_boot = boot
def boot(person):
    b = _boot(person); b['exercise'] = PLANS_EX + watch(); return b
def handle2(route, request):
    if request.method == 'POST':
        body = json.loads(request.post_data or '{}')
        if body.get('action') == 'read' and body.get('tab') == 'Exercise':
            rows = [dict(EntryID=p['id'], Planned='Yes') for p in PLANS_EX] + [dict(EntryID=f"AW-2026{w['id']}", Planned=w['planned'] or '') for w in CASES[CUR[0]]]
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'rows': rows}))
    return handle(route, request)
with sync_playwright() as pw:
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for case, expect_plans in [('one', ['23 min', 'Walking']), ('two', ['Walking']), ('handled', ['48 min', '23 min', 'Walking']), ('short_first', ['48 min', 'Walking'])]:
        CUR[0] = case
        ctx = br.new_context(viewport={'width': 390, 'height': 844}); page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.route(API + '*', handle2); page.route(re.compile(r'.*cdn\.jsdelivr.*'), lambda r, q: r.abort())
        page.goto('http://127.0.0.1:8765/josh/?k=test'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(900)
        planned = page.locator('.entry.planned[data-ex] small').all_inner_texts()
        names = page.locator('.entry.planned[data-ex] .nm > div').all_inner_texts()
        got = [t.split(' ·')[0] if 'Bicycling' in n else 'Walking' for n, t in zip(names, planned)]
        check(sorted(got) == sorted(expect_plans), f'{case}: planned shown {got} expected {expect_plans}')
        check(not errs, f'{case}: no errors {errs[:1]}')
        if case == 'two': page.locator('.card', has_text='Exercise').last.screenshot(path='/tmp/ex_two.png')
        ctx.close()
    br.close()
srv.shutdown()
print('FAILS:', fails) if fails else print('ALL PASS')
