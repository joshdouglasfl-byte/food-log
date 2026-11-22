"""Playwright test for the plan card's This week / Next week onward toggle (future plan), API stubbed. Usage: python3 -I tests/test_nextplan.py <repo>"""
import json, sys, datetime, re, os, threading, http.server, functools
from playwright.sync_api import sync_playwright

REPO = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'); os.makedirs(OUT, exist_ok=True)
API = 'https://script.google.com/macros/s/AKfycbx1Z0lkyHaiQ8n0kCC9TMqATaGZDWtippwscqGsdmSHhXTvDwDencxqDCjdFlsaqbp5Ug/exec'
T = datetime.date.today()
D = lambda n: (T + datetime.timedelta(days=n)).isoformat()
MON = T - datetime.timedelta(days=T.weekday()); NEXT_MON = (MON + datetime.timedelta(days=7)).isoformat(); THIS_MON = MON.isoformat()
EXTRA = {}; EXROWS = []

def profile(person):
    p = {'Person': person, 'Birthday': '1975-06-01', 'Sex': 'Male' if person == 'Josh' else 'Female', 'Height (in)': 70 if person == 'Josh' else 64,
         'Activity level': 'Sedentary', 'Weekly goal (lb/week)': -0.5, 'Manual adjustment (cal)': -300, 'High days': '', 'High day extra (cal)': 0,
         'Weekday adjustment (cal)': 0, 'Weekend adjustment (cal)': 0, 'Meal slots': 'Breakfast, Lunch, Dinner, Snacks', 'Track water': 'No', 'Show target first': 'No', 'Next plan': ''}
    p.update(EXTRA); return p

def boot(person):
    return dict(ok=True, profile=profile(person), foods=[], meals=[], log=[], exercise=EXROWS,
                days=[dict(date=D(0), budget=1, done=False, water=0), dict(date=NEXT_MON, budget=1, done=False, water=0)],
                body=[dict(date=D(-i), weight=210 - i * 0.05, fatPct=25, fatLb=52) for i in range(10, 0, -1)], plan=[], serverTime=datetime.datetime.now().isoformat())

CALLS = []
def handle(route, request):
    if request.method == 'GET':
        person = re.search(r'person=(\w+)', request.url).group(1)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(boot(person)))
    body = json.loads(request.post_data or '{}')
    CALLS.extend(body.get('batch') or [body])
    res = {'ok': True, 'rows': []}
    if body.get('batch'): res = {'ok': True, 'results': [{'ok': True} for _ in body['batch']]}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(res))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(Q, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def settings_calls():
    out = []
    for c in CALLS:
        if c.get('action') == 'saveSettings': out.append(c['settings'])
        for q in (c.get('ops') or []):
            if q.get('action') == 'saveSettings': out.append(q['settings'])
    return out
def ls(page, k, d='null'): return page.evaluate(f"(() => {{ const k = Object.keys(localStorage).find(x => /^fl-\\w+-{k}$/.test(x)); return JSON.parse(k ? localStorage.getItem(k) : '{d}'); }})()")
def prof(page): return ls(page, 'data')['profile']
def queued(page, action): return [q for q in (ls(page, 'queue', '[]') or []) if q.get('action') == action]

def open_page(pw, w, h, person='josh'):
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route(API + '*', handle); page.route(re.compile(r'.*cdn\.jsdelivr.*'), lambda r, q: r.abort())
    page.goto(f'http://127.0.0.1:8766/{person}/?k=test'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(600)
    return br, page, errs

def all_saved(page):
    # everything the app sent or still has queued
    s = settings_calls() + [(q.get('body') or q.get('params') or q).get('settings', {}) for q in queued(page, 'saveSettings')]
    return s

def run(pw, w, h, tag):
    EXTRA.clear(); CALLS.clear()
    br, page, errs = open_page(pw, w, h)
    page.click('nav.tabs [data-view=settings]'); page.wait_for_timeout(300)
    check(page.locator('.plan-scope button.on').inner_text() == 'Next week onward', f'{tag}: plan card opens on Next week')
    check(page.locator('.plan-next').count() == 0, f'{tag}: no note without a future plan')
    page.screenshot(path=f'{OUT}/nextplan_{tag}_open.png')
    page.select_option('#goalsel', '-1'); page.wait_for_timeout(300)
    p = prof(page); n = json.loads(p['Next plan'] or '{}')
    check(p['Weekly goal (lb/week)'] == -0.5, f'{tag}: current weekly goal unchanged')
    check(n.get('from') == NEXT_MON and n.get('set', {}).get('Weekly goal (lb/week)') == -1, f'{tag}: future plan saved from next Monday {n}')
    check('lose 1 lb/week' in page.locator('.plan-next').inner_text(), f'{tag}: note shows next week goal')
    check(page.locator('#goalsel').input_value() == '-1', f'{tag}: Next week view shows the new goal')
    # Days budgets: today keeps the current plan; next Monday moves to the future plan
    data = ls(page, 'data')
    bud = {d['date']: d['budget'] for d in data['days']}
    check(bud[NEXT_MON] < bud[D(0)] - 200 or T.weekday() == 0 and False, f'{tag}: next Monday budget lower than today ({bud[NEXT_MON]} vs {bud[D(0)]})')
    # schedule in Next week mode
    page.click('[data-m-open=sched]'); page.wait_for_selector('.sheet')
    page.click('.sheet [data-dow=Sat]'); page.click('.sheet [data-dow=Sun]'); page.click('.sheet [data-xtra="300"]'); page.click('.sheet [data-m=schedsave]'); page.wait_for_timeout(300)
    p = prof(page); n = json.loads(p['Next plan'] or '{}')
    check(p['High days'] == '' and n['set'].get('High days') == 'Sat,Sun' and n['set'].get('High day extra (cal)') == 300, f'{tag}: schedule saved to future plan only')
    check('high Sat, Sun +300' in page.locator('.plan-next').inner_text(), f'{tag}: note lists schedule')
    page.screenshot(path=f'{OUT}/nextplan_{tag}_next.png')
    # This week: edits go to the current plan, note still shows
    page.click('[data-pscope=this]'); page.wait_for_timeout(200)
    check(page.locator('#goalsel').input_value() == '-0.5', f'{tag}: This week shows the current goal')
    check(page.locator('.plan-next').count() == 1 and page.locator('.plan-next .link-btn').count() == 0, f'{tag}: note shows on This week')
    page.select_option('#mansel', '-200'); page.wait_for_timeout(300)
    p = prof(page)
    check(p['Manual adjustment (cal)'] == -200 and json.loads(p['Next plan'])['set'].get('Manual adjustment (cal)') is None, f'{tag}: This week change saved to current plan')
    page.screenshot(path=f'{OUT}/nextplan_{tag}_this.png')
    # leaving and coming back opens on Next week again
    page.click('nav.tabs [data-view=day]'); page.click('nav.tabs [data-view=settings]'); page.wait_for_timeout(200)
    check(page.locator('.plan-scope button.on').inner_text() == 'Next week onward', f'{tag}: reopens on Next week')
    # setting next week's goal back to the current one keeps the rest of the future plan
    page.select_option('#goalsel', '-0.5'); page.wait_for_timeout(300)
    n = json.loads(prof(page)['Next plan'] or '{}')
    check('Weekly goal (lb/week)' not in n['set'] and n['set'].get('High days') == 'Sat,Sun', f'{tag}: matching field dropped, rest kept')
    # Keep current plan clears it
    page.click('[data-act=cancelnext]'); page.wait_for_timeout(300)
    check(prof(page)['Next plan'] == '' and page.locator('.plan-next').count() == 0, f'{tag}: Keep current plan clears the future plan')
    check(any('Next plan' in s for s in all_saved(page)), f'{tag}: Next plan sent through saveSettings')
    # a background refresh must not redraw the page under an open picker (it closes the iPhone picker)
    page.evaluate("window._gs = document.querySelector('#goalsel'); window._gs.focus()")
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); page.wait_for_timeout(1200)
    check(page.evaluate("window._gs.isConnected && document.activeElement === window._gs"), f'{tag}: open goal picker survives a background refresh')
    page.evaluate("window._gs.blur()"); page.wait_for_timeout(300)
    check(not page.evaluate("window._gs.isConnected"), f'{tag}: deferred redraw runs after the picker closes')
    check(not errs, f'{tag}: no page errors {errs[:2]}')
    br.close()

def run_promote(pw):
    EXTRA.clear(); CALLS.clear()
    EXTRA['Next plan'] = json.dumps({'from': THIS_MON, 'set': {'Weekly goal (lb/week)': -1, 'Manual adjustment (cal)': -400}})
    br, page, errs = open_page(pw, 390, 844)
    p = prof(page)
    check(p['Weekly goal (lb/week)'] == -1 and p['Manual adjustment (cal)'] == -400 and p['Next plan'] == '', f'promote: future plan becomes current on its Monday')
    check(any(s.get('Next plan') == '' and s.get('Weekly goal (lb/week)') == -1 for s in all_saved(page)), 'promote: sent to the sheet')
    check(not errs, f'promote: no page errors {errs[:2]}')
    br.close()
    # a future plan not yet due stays waiting
    EXTRA['Next plan'] = json.dumps({'from': NEXT_MON, 'set': {'Weekly goal (lb/week)': -1}})
    br, page, errs = open_page(pw, 390, 844, 'michelle')
    page.click('nav.tabs [data-view=settings]'); page.wait_for_timeout(300)
    p = prof(page)
    check(p['Weekly goal (lb/week)'] == -0.5 and json.loads(p['Next plan'])['from'] == NEXT_MON, 'michelle: waiting plan not promoted early')
    check('lose 1 lb/week' in page.locator('.plan-next').inner_text(), 'michelle: note shows')
    page.screenshot(path=f'{OUT}/nextplan_michelle.png')
    check(not errs, f'michelle: no page errors {errs[:2]}')
    br.close()

def run_exedit(pw):
    # planned exercise: changing minutes recalculates calories (no library rate, so the entry's own cal/min)
    EXTRA.clear(); CALLS.clear()
    EXROWS[:] = [dict(date=D(3), name='Golf', min=240, cal=1000, source='Plan', id='XG1'), dict(date=D(-2), name='Bike ride', min=40, cal=380, source='Apple Watch', id='AW-1')]
    br, page, errs = open_page(pw, 390, 844)
    for _ in range(3): page.click('[data-act=next]'); page.wait_for_timeout(100)
    page.click('[data-ex]'); page.wait_for_selector('#xmin')
    page.fill('#xmin', '120'); page.wait_for_timeout(100)
    check(page.input_value('#xcal') == '500', f'exedit: planned golf 240→120 min recalculates calories ({page.input_value("#xcal")})')
    check('EST' in page.inner_text('#lxcal'), 'exedit: calories marked EST')
    page.click('[data-m=exupd]'); page.wait_for_timeout(300)
    up = [q['body'] for q in queued(page, 'update') if q['body'].get('id') == 'XG1'] + [c for c in CALLS if c.get('id') == 'XG1']
    check(any(u['values'].get('Calories') == 500 and u['values'].get('Minutes') == 120 for u in up), f'exedit: saved 120 min / 500 cal')
    # a measured (watch) workout keeps its calories when minutes change
    page.click('[data-act=prev]'); [page.click('[data-act=prev]') for _ in range(4)]; page.wait_for_timeout(200)
    page.click('[data-ex]'); page.wait_for_selector('#xmin')
    page.fill('#xmin', '50'); page.wait_for_timeout(100)
    check(page.input_value('#xcal') == '380', 'exedit: measured workout calories stay put')
    check(not errs, f'exedit: no page errors {errs[:2]}')
    br.close(); EXROWS.clear()

with sync_playwright() as pw:
    run(pw, 390, 844, 'phone'); run(pw, 820, 1180, 'ipad'); run_promote(pw); run_exedit(pw)
srv.shutdown()
print('FAILS:', fails) if fails else print('ALL PASS')
