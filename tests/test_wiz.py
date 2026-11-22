"""Playwright test for the Food Log Meal Wizard, API stubbed via page.route. Usage: python3 -I test_wiz.py <repo>"""
import json, random, sys, datetime, re, os, threading, http.server, functools
from playwright.sync_api import sync_playwright

REPO = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots'); os.makedirs(OUT, exist_ok=True)
API = 'https://script.google.com/macros/s/AKfycbx1Z0lkyHaiQ8n0kCC9TMqATaGZDWtippwscqGsdmSHhXTvDwDencxqDCjdFlsaqbp5Ug/exec'
T = datetime.date.today()
D = lambda n: (T + datetime.timedelta(days=n)).isoformat()

FOODS = [
  # id, name, brand, unit, per, cal, pro, fib, carb, fat
  ('F1', 'Oatmeal', '', 'Serving', 1, 150, 5, 4, 27, 3),
  ('F2', 'Greek Yogurt', '', 'Each', 1, 120, 17, 0, 7, 0),
  ('F3', 'Banana', '', 'Each', 1, 105, 1.3, 3.1, 27, 0.4),
  ('F4', 'Eggs', '', 'Each', 1, 72, 6.3, 0, 0.4, 4.8),
  ('F5', 'Chicken Breast', '', 'Gram', 1, 1.65, 0.31, 0, 0, 0.036),
  ('F6', 'Rice', '', 'Cup', 1, 205, 4.3, 0.6, 45, 0.4),
  ('F7', 'Turkey Sandwich', '', 'Each', 1, 350, 25, 3, 35, 12),
  ('F8', 'Side Salad', '', 'Serving', 1, 150, 3, 4, 10, 10),
  ('F9', 'Hamburger, McDouble', "McDonald's", 'Each', 1, 380, 23, 2, 34, 18),
  ('F10', 'World Famous Fries, Medium', "McDonald's", 'Serving', 1, 320, 5, 4, 43, 15),
  ('F11', 'Protein Shake', '', 'Serving', 1, 160, 30, 1, 5, 2),
  ('F12', 'Almonds', '', 'Gram', 1, 5.8, 0.21, 0.125, 0.22, 0.5),
  ('F13', 'Salmon', '', 'Gram', 1, 2.08, 0.2, 0, 0, 0.13),
  ('F14', 'Broccoli', '', 'Gram', 1, 0.34, 0.028, 0.026, 0.066, 0.004),
  ('F15', 'Coffee with milk', '', 'Serving', 1, 40, 2, 0, 4, 2),
  ('F16', 'Cookie', '', 'Each', 1, 160, 2, None, 22, 8),
  ('F17', 'Pizza slice', '', 'Each', 1, 285, 12, 2.5, 36, 10),
  ('F18', 'Black beans', '', 'Cup', 1, 227, 15, 15, 41, 1),
  ('F19', 'Apple', '', 'Each', 1, 95, 0.5, 4.4, 25, 0.3),
]
FB = {f[0]: f for f in FOODS}
def entry(fid, qty, unit, meal, date, planned=None, i=0):
    f = FB[fid]; k = qty / f[4]
    if unit == 'Serving' and f[3] == 'Gram': k = qty * 28 / f[4]
    n = lambda v: None if v is None else round(v * k, 1)
    e = dict(date=date, time='', food=fid, meal=meal, name=f[1], qty=qty, unit=unit, cal=n(f[5]), pro=n(f[6]), fib=n(f[7]), carb=n(f[8]), fat=n(f[9]), est=False, id=f'L{date.replace("-", "")}{i:03d}')
    return e

rnd = random.Random(7)
LOG = []
for d in range(1, 171):
    day = D(-d); i = 0
    def add(fid, qty, unit, meal):
        global i; LOG.append(entry(fid, qty, unit, meal, day, i=len(LOG)))
    if rnd.random() < 0.3: add('F15', 1, 'Serving', 'Early Snacks')
    b = rnd.choice([[('F1', 1, 'Serving'), ('F3', 1, 'Each')], [('F2', 1, 'Each'), ('F3', 1, 'Each')], [('F4', 2, 'Each')], [('F4', 3, 'Each'), ('F2', 1, 'Each')], [('F1', 1.5, 'Serving')]])
    for x in b: add(*x, 'Breakfast')
    l = rnd.choice([[('F9', 1, 'Each'), ('F10', 1, 'Serving')], [('F7', 1, 'Each'), ('F19', 1, 'Each')], [('F8', 1, 'Serving'), ('F5', 150, 'Gram')], [('F7', 1, 'Each')], [('F18', 1, 'Cup'), ('F6', 1, 'Cup')]])
    for x in l: add(*x, 'Lunch')
    dn = rnd.choice([[('F5', 180, 'Gram'), ('F6', 1, 'Cup'), ('F14', 100, 'Gram')], [('F13', 170, 'Gram'), ('F14', 150, 'Gram')], [('F17', 2, 'Each'), ('F8', 1, 'Serving')], [('F5', 200, 'Gram'), ('F18', 0.5, 'Cup')], [('F13', 150, 'Gram'), ('F6', 0.75, 'Cup'), ('F8', 1, 'Serving')]])
    for x in dn: add(*x, 'Dinner')
    for x in rnd.sample([('F11', 1, 'Serving'), ('F12', 1, 'Serving'), ('F16', 1, 'Each'), ('F2', 1, 'Each'), ('F19', 1, 'Each')], rnd.choice([0, 1, 2])): add(*x, 'Snacks')
LOG.append(entry('F1', 1, 'Serving', 'Breakfast', D(0), i=9001))
LOG.append(entry('F17', 2, 'Each', 'Dinner', D(1), i=9002))   # planned for tomorrow
LOG.append(entry('F8', 1, 'Serving', 'Dinner', D(1), i=9003))
EX = []
for d in range(1, 171):
    if d % 3 == 0: EX.append(dict(date=D(-d), name='Bike ride', min=45, cal=410, source='Apple Watch', id=f'AW{d}'))
    if d % 4 == 1: EX.append(dict(date=D(-d), name='Weightlifting', min=60, cal=250, source='Workout Buddy', id=f'WB{d}'))
MEALS = [dict(id='MUJ6YP9LW', name='McDouble Meal', items=json.dumps([
  dict(food='F9', name='Hamburger, McDouble', qty=1, unit='Each', cal=380, pro=23, fib=2, carb=34, fat=18, est=False),
  dict(food='F10', name='World Famous Fries, Medium', qty=1, unit='Serving', cal=320, pro=5, fib=4, carb=43, fat=15, est=False)]), cal=700)]

def profile(person):
    return {'Person': person, 'Birthday': '1975-06-01', 'Sex': 'Male' if person == 'Josh' else 'Female', 'Height (in)': 70 if person == 'Josh' else 64,
            'Activity level': 'Sedentary', 'Weekly goal (lb/week)': -0.5, 'Manual adjustment (cal)': -300, 'Meal slots': 'Early Snacks, Breakfast, Lunch, Dinner, Snacks',
            'Track water': 'No', 'Protein goal (g)': 130, 'Carbs goal (g)': 200, 'Fat goal (g)': 70, 'Fiber goal (g)': 25, 'Show target first': 'No'}

def boot(person):
    return dict(ok=True, profile=profile(person), foods=[dict(id=f[0], name=f[1], brand=f[2], unit=f[3], per=f[4], cal=f[5], pro=f[6], fib=f[7], carb=f[8], fat=f[9], barcode='', est=False) for f in FOODS],
                meals=MEALS, log=LOG if person == 'Josh' else LOG[:400], exercise=EX, days=[], body=[dict(date=D(-i), weight=210 - i * 0.05, fatPct=25, fatLb=52) for i in range(30, 0, -1)],
                plan=[], serverTime=datetime.datetime.now().isoformat())

CALLS = []; PLANS = []
def handle(route, request):
    if request.method == 'GET':
        person = re.search(r'person=(\w+)', request.url).group(1)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(boot(person)))
    body = json.loads(request.post_data or '{}'); CALLS.append(body)
    a = body.get('action'); res = {'ok': True}
    if a == 'append' and body.get('tab') == 'Day Plans': PLANS.extend(body['rows'])
    if a == 'delete' and body.get('tab') == 'Day Plans': PLANS[:] = [r for r in PLANS if r['PlanID'] != body['id']]
    if a == 'read':
        tab = body.get('tab')
        if tab == 'Servings': res['rows'] = [dict(FoodID='F12', Unit='Serving', Grams=28, EntryID='S1')]
        elif tab == 'Exercises': res['rows'] = [dict(ExerciseID='EX1', Activity='Bike ride', **{'Josh cal/min': 9, 'Michelle cal/min': 7}), dict(ExerciseID='EX2', Activity='Weightlifting', **{'Josh cal/min': 4.2})]
        elif tab == 'Day Plans': res['rows'] = [r for r in PLANS if r['Person'] == body.get('person')]
        else: res['rows'] = []
    route.fulfill(status=200, content_type='application/json', body=json.dumps(res))

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(Q, directory=REPO))
threading.Thread(target=srv.serve_forever, daemon=True).start()

fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def run(pw, w, h, tag):
    PLANS.clear()
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errs.append('console: ' + m.text))
    page.route(API + '*', handle); page.route(re.compile(r'.*cdn\.jsdelivr.*'), lambda r, q: r.abort())
    page.goto('http://127.0.0.1:8765/josh/?k=test'); page.wait_for_selector('nav.tabs')
    page.wait_for_timeout(600)
    check(page.locator('nav.tabs button').count() == 5, f'[{tag}] five nav tabs')
    page.click('nav.tabs button[data-view=wiz]'); page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/{tag}-1-blank.png', full_page=True)
    check('Tap 🪄 Wand' in page.inner_text('main'), f'[{tag}] blank wizard prompt')
    ev = lambda js: page.evaluate(js)
    # --- wand fills a blank day ---
    okc = 0
    for _ in range(6):
        page.click('[data-wzact=wand]'); page.wait_for_timeout(150)
        r = ev('''() => { const D = FL_DEBUG, w = D.wiz(), e = D.wzEval(D.wzTotals(w.items), D.wzTargets(w), w); return { ok: e.ok, miss: e.miss, n: w.items.length, items: w.items.map(i => [i.meal, i.food || i.name, i.qty, i.unit, i.sub ? 1 : 0, i.mealId || '']) } }''')
        okc += r['ok']
        ids = [x[1] for x in r['items']]
        check(len(ids) == len(set(ids)), f'[{tag}] no repeats within the day')
        per = {}
        for x in r['items']: per[x[0]] = per.get(x[0], 0) + 1
        check(all(v <= 3 for v in per.values()), f'[{tag}] at most 3 items per slot {per}')
        # slot-aware and logged portions only
        slotsOf = {}; pors = {}
        for e in LOG:
            if e['date'] < D(0): slotsOf.setdefault(e['food'], set()).add(e['meal'])
        bad = [x for x in r['items'] if not x[4] and x[0] not in slotsOf.get(x[1], set())]
        check(not bad, f'[{tag}] foods only offered in slots they were logged in {bad}')
        grams = [x for x in r['items'] if x[3] == 'Gram' and x[2] % 5]
        check(not grams, f'[{tag}] no odd gram counts {grams}')
        check(not any(x[1] == 'F16' for x in r['items']), f'[{tag}] cookie (blank fiber) skipped while fiber is checked')
    check(okc >= 4, f'[{tag}] wand met all targets in {okc}/6 rolls')
    sigs = set()
    for _ in range(4):
        page.click('[data-wzact=wand]'); page.wait_for_timeout(100)
        sigs.add(ev('() => FL_DEBUG.wiz().items.map(i => i.food || i.name).sort().join()'))
    check(len(sigs) >= 2, f'[{tag}] rerolling gives different results ({len(sigs)} distinct of 4)')
    page.screenshot(path=f'{OUT}/{tag}-2-wand.png', full_page=True)
    # --- locks ---
    key = ev('() => FL_DEBUG.wiz().items[0].key'); name = ev('() => FL_DEBUG.wiz().items[0].name')
    page.click(f'[data-wzpin="{key}"]')
    stay = True
    for _ in range(5):
        page.click('[data-wzact=wand]'); page.wait_for_timeout(80)
        stay = stay and ev(f'() => FL_DEBUG.wiz().items.some(i => i.key === "{key}" && i.locked)')
    check(stay, f'[{tag}] locked item ({name}) survives 5 rerolls')
    page.click(f'[data-wzpin="{key}"]')
    # --- swaps ---
    k2 = ev('() => FL_DEBUG.wiz().items.find(i => !i.sub).key')
    page.click(f'[data-wzitem="{k2}"] .nm'); page.wait_for_selector('.sheet')
    n = page.locator('[data-wzswap]').count()
    check(1 <= n <= 3, f'[{tag}] swap sheet offers {n} swaps')
    page.screenshot(path=f'{OUT}/{tag}-3-swaps.png')
    if n:
        before = ev(f'() => FL_DEBUG.wiz().items.find(i => i.key === "{k2}").name')
        page.locator('[data-wzswap]').first.click(); page.wait_for_timeout(150)
        after = ev(f'() => FL_DEBUG.wiz().items.find(i => i.key === "{k2}").name')
        check(before != after, f'[{tag}] swap replaced {before} with {after}')
    # --- unchecked targets ---
    for k in ['pro', 'carb', 'fat', 'fib']: page.click(f'[data-wzchk={k}]'); page.wait_for_timeout(50)
    print('   snack picks:', ev('() => { const c = {}; for (let i = 0; i < 60; i++) { FL_DEBUG.wzWand(); FL_DEBUG.wiz().items.filter(x => x.meal === "Snacks").forEach(x => c[x.name] = (c[x.name] || 0) + 1); } return [c, FL_DEBUG.wiz().chk]; }'))
    cookie = ev('() => { for (let i = 0; i < 60; i++) { FL_DEBUG.wzWand(); if (FL_DEBUG.wiz().items.some(x => x.food === "F16")) return true; } return false; }')
    okc = 0
    for _ in range(12):
        page.click('[data-wzact=wand]'); page.wait_for_timeout(60)
        r = ev('() => { const D = FL_DEBUG, w = D.wiz(), e = D.wzEval(D.wzTotals(w.items), D.wzTargets(w), w); return { ok: e.ok, miss: e.miss, f: w.items.map(i => i.food) } }')
        okc += r['ok']
        check(all(not m.startswith(('Protein', 'Carbs', 'Fat', 'Fiber')) for m in r['miss']), f'[{tag}] unchecked macros ignored')
    check(okc >= 10, f'[{tag}] calories-only met {okc}/12')
    check(cookie, f'[{tag}] cookie allowed once fiber is unchecked')
    for k in ['pro', 'carb', 'fat', 'fib']: page.click(f'[data-wzchk={k}]'); page.wait_for_timeout(50)
    # --- infeasible ---
    ev("() => { FL_DEBUG.state.data.profile['Protein goal (g)'] = 320; }")
    page.click('[data-wzact=wand]'); page.wait_for_timeout(150)
    st = page.inner_text('.wz-status')
    check('Protein' in st and 'short' in st, f'[{tag}] infeasible shows what is off: "{st}"')
    check(ev('() => !FL_DEBUG.wiz().ex.some(e => e.kind === "suggest")'), f'[{tag}] no exercise suggested while "No additional exercise" is on')
    page.screenshot(path=f'{OUT}/{tag}-4-infeasible.png', full_page=True)
    # --- exercise suggestion on ---
    page.click('[data-wzact=noex]'); page.wait_for_timeout(100)
    got = False
    for _ in range(3):
        page.click('[data-wzact=wand]'); page.wait_for_timeout(300)
        got = got or ev('() => FL_DEBUG.wiz().ex.some(e => e.kind === "suggest")')
        if got: break
    check(got, f'[{tag}] exercise suggested when food alone falls short')
    if got:
        txt = page.inner_text('.wz-sug'); check('suggested' in txt and 'min' in txt, f'[{tag}] suggestion shows duration/burn: {txt!r}')
        page.screenshot(path=f'{OUT}/{tag}-5-exsuggest.png', full_page=True)
        page.click('[data-wzkeep]'); page.wait_for_timeout(80)
        check(ev('() => FL_DEBUG.wiz().ex.some(e => e.kind === "manual")'), f'[{tag}] Keep turns the suggestion into a plan item')
        page.click('[data-wzexdel]'); page.wait_for_timeout(80)
    page.click('[data-wzact=noex]'); page.wait_for_timeout(80)
    ev("() => { FL_DEBUG.state.data.profile['Protein goal (g)'] = 130; }")
    # --- clear, manual add via existing add sheet ---
    page.click('[data-wzact=clear]'); page.wait_for_timeout(80)
    page.click('[data-wzadd=Lunch]'); page.wait_for_selector('#q')
    check('plan' in page.inner_text('.sheet-head'), f'[{tag}] add sheet titled for the plan')
    page.fill('#q', 'turkey'); page.wait_for_timeout(400)
    page.locator('[data-food=F7]').click(); page.wait_for_selector('[data-m=foodsave]'); page.click('[data-m=foodsave]'); page.wait_for_timeout(150)
    r = ev('() => FL_DEBUG.wiz().items.map(i => [i.meal, i.name, i.kind, i.locked])')
    check(r == [['Lunch', 'Turkey Sandwich', 'manual', True]], f'[{tag}] manual add lands in the plan: {r}')
    check(not any(c.get('action') == 'addLog' for c in CALLS), f'[{tag}] manual add does not write the log')
    # saved meal as one item
    page.click('[data-wzadd=Dinner]'); page.wait_for_selector('#q'); page.click('[data-tab=meals]'); page.wait_for_timeout(100)
    page.locator('[data-smeal="0"]').click(); page.wait_for_selector('[data-m=mealsave]'); page.click('[data-m=mealsave]'); page.wait_for_timeout(150)
    check(ev('() => FL_DEBUG.wiz().items.some(i => i.sub && i.name === "McDouble Meal")'), f'[{tag}] saved meal added as one item')
    # exercise add
    page.click('[data-wzact=addex]'); page.wait_for_selector('#xq'); page.locator('[data-xpick]').first.click(); page.wait_for_selector('#xmin')
    page.fill('#xmin', '30'); page.wait_for_timeout(50); page.click('[data-m=exsave]'); page.wait_for_timeout(100)
    check(ev('() => FL_DEBUG.wiz().ex.length === 1 && FL_DEBUG.wiz().ex[0].cal > 0'), f'[{tag}] exercise added to plan from the picker')
    tg = ev('() => { const w = FL_DEBUG.wiz(), t = FL_DEBUG.wzTargets(w); return [t.cal, t.budget, t.exCal] }')
    check(abs(tg[0] - tg[1] - tg[2]) < 1 and tg[2] > 0, f'[{tag}] calorie target = budget + plan exercise {tg}')
    page.click('[data-wzexdel]'); page.click('[data-wzact=clear]'); page.wait_for_timeout(80)
    # --- pull in day (tomorrow has pizza + salad planned) ---
    page.fill('#wzdate', D(1)); page.dispatch_event('#wzdate', 'change'); page.wait_for_timeout(100)
    page.click('[data-wzact=pull]'); page.wait_for_selector('#wzpd')
    page.click('[data-m=wzpullgo]'); page.wait_for_timeout(100)
    r = ev('() => FL_DEBUG.wiz().items.map(i => [i.name, i.kind, i.locked, i.srcDate])')
    check(len(r) == 2 and all(x[1] == 'pulled' and x[2] for x in r), f'[{tag}] pulled in tomorrow as locked items {r}')
    page.click('[data-wzact=wand]'); page.wait_for_timeout(150)
    r = ev('() => FL_DEBUG.wiz().items.map(i => [i.name, i.kind, i.meal])')
    check(sum(1 for x in r if x[1] == 'pulled') == 2 and len(r) > 2, f'[{tag}] wand fills around pulled items ({len(r)} items)')
    page.screenshot(path=f'{OUT}/{tag}-6-pulled.png', full_page=True)
    # --- apply: tomorrow + two more weekdays for 2 weeks ---
    CALLS.clear()
    page.click('[data-wzact=apply]'); page.wait_for_selector('[data-m=wzapplygo]')
    dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    tomorrow = datetime.date.fromisoformat(D(1)); picks = [(tomorrow + datetime.timedelta(days=2)).strftime('%a'), (tomorrow + datetime.timedelta(days=4)).strftime('%a')]
    for p in picks: page.click(f'[data-wzdow={p}]'); page.wait_for_timeout(50)
    page.click('[data-wzwk="2"]'); page.wait_for_timeout(50)
    page.screenshot(path=f'{OUT}/{tag}-7-apply.png')
    lbl = page.inner_text('[data-m=wzapplygo]')
    check('5 days' in lbl, f'[{tag}] apply covers tomorrow + 2 weekdays x 2 weeks: {lbl!r}')
    plan_n = ev('() => FL_DEBUG.wiz().items.reduce((a, i) => a + (i.sub ? i.sub.length : 1), 0)')
    page.click('[data-m=wzapplygo]'); page.wait_for_timeout(300)
    adds = [c for c in CALLS if c.get('action') == 'addLog']
    dates = sorted({e['date'] for c in adds for e in c['entries']})
    check(len(dates) == 5, f'[{tag}] wrote planned rows on 5 dates {dates}')
    t_rows = [e for c in adds for e in c['entries'] if e['date'] == D(1)]
    check(len(t_rows) == plan_n - 2 and not any(e['name'] == 'Pizza slice' for e in t_rows), f'[{tag}] tomorrow gets the plan minus its own pulled rows ({len(t_rows)} of {plan_n})')
    other = [e for c in adds for e in c['entries'] if e['date'] == dates[-1]]
    check(any(e['name'] == 'Pizza slice' for e in other), f'[{tag}] other dates get the pulled pizza too')
    ups = [c for c in CALLS if c.get('action') == 'update' and c.get('tab') == 'Log' and c['values'].get('Planned') == 'Yes']
    check(len(ups) == sum(len(c['entries']) for c in adds), f'[{tag}] every applied row is marked Planned = Yes ({len(ups)})')
    # applying again without replace leaves those slots alone
    CALLS.clear(); page.click('[data-wzact=apply]'); page.wait_for_selector('[data-m=wzapplygo]'); page.click('[data-m=wzapplygo]'); page.wait_for_timeout(200)
    check(not [c for c in CALLS if c.get('action') == 'addLog'], f'[{tag}] re-apply does not touch slots that already have food')
    CALLS.clear(); page.click('[data-wzact=apply]'); page.wait_for_selector('[data-m=wzapplygo]'); page.click('[data-m=wzrep]'); page.click('[data-m=wzapplygo]'); page.wait_for_timeout(200)
    dels = [c for c in CALLS if c.get('action') == 'deleteLog']; adds = [c for c in CALLS if c.get('action') == 'addLog']
    check(dels and adds, f'[{tag}] replace swaps planned food ({len(dels)} deleted, {sum(len(c["entries"]) for c in adds)} added)')
    # today: eaten breakfast is never replaced
    page.click('[data-wzact=clear]'); page.fill('#wzdate', D(0)); page.dispatch_event('#wzdate', 'change'); page.wait_for_timeout(80)
    page.click('[data-wzadd=Breakfast]'); page.wait_for_selector('#q'); page.fill('#q', 'eggs'); page.wait_for_timeout(350)
    page.locator('[data-food=F4]').click(); page.click('[data-m=foodsave]'); page.wait_for_timeout(80)
    CALLS.clear(); page.click('[data-wzact=apply]'); page.wait_for_selector('[data-m=wzapplygo]'); page.click('[data-m=wzrep]'); page.click('[data-m=wzapplygo]'); page.wait_for_timeout(200)
    check(not [c for c in CALLS if c.get('action') in ('addLog', 'deleteLog')], f'[{tag}] eaten breakfast today is never replaced')
    # --- save plan ---
    page.click('[data-wzact=wand]'); page.wait_for_timeout(120)
    CALLS.clear(); page.click('[data-wzact=save]'); page.wait_for_selector('#wzname'); page.fill('#wzname', 'High-protein weekday'); page.click('[data-m=wzsavego]'); page.wait_for_timeout(200)
    ap = [c for c in CALLS if c.get('action') == 'append' and c.get('tab') == 'Day Plans']
    ok = bool(ap) and ap[0]['rows'][0]['Person'] == 'Josh' and ap[0]['headers'][0] == 'PlanID'
    items = json.loads(ap[0]['rows'][0]['Items (JSON)']) if ap else []
    check(ok and items and all('slot' in x and 'qty' in x for x in items), f'[{tag}] save writes a Day Plans row ({len(items)} items)')
    page.click('[data-wzact=clear]'); page.click('[data-wzact=plans]'); page.wait_for_selector('.sheet')
    check('High-protein weekday' in page.inner_text('.sheet'), f'[{tag}] saved plan listed')
    page.screenshot(path=f'{OUT}/{tag}-8-plans.png')
    page.click('[data-wzload="0"]'); page.wait_for_timeout(100)
    check(ev('() => FL_DEBUG.wiz().items.length') > 0, f'[{tag}] loading a saved plan fills the wizard')
    page.screenshot(path=f'{OUT}/{tag}-9-loaded.png', full_page=True)
    # tolerance
    page.click('[data-wzact=tol]'); page.wait_for_selector('#wztc'); page.fill('#wztc', '100'); page.fill('#wztg', '15'); page.click('[data-m=wztolsave]'); page.wait_for_timeout(80)
    check('±100 cal · ±15 g' in page.inner_text('.wz-tol'), f'[{tag}] tolerance adjustable')
    # other tabs still render
    for v in ['day', 'week', 'settings', 'prefs']:
        page.click(f'nav.tabs button[data-view={v}]'); page.wait_for_timeout(120)
    page.screenshot(path=f'{OUT}/{tag}-10-today.png')
    # Michelle
    page2 = ctx.new_page(); page2.on('pageerror', lambda e: errs.append('michelle: ' + str(e)))
    page2.route(API + '*', handle); page2.goto('http://127.0.0.1:8765/michelle/?k=test'); page2.wait_for_selector('nav.tabs'); page2.wait_for_timeout(400)
    page2.click('nav.tabs button[data-view=wiz]'); page2.click('[data-wzact=wand]'); page2.wait_for_timeout(200)
    check(page2.evaluate('() => FL_DEBUG.wiz().items.length') > 0, f'[{tag}] works on Michelle\'s page')
    page2.screenshot(path=f'{OUT}/{tag}-11-michelle.png', full_page=True)
    check(not errs, f'[{tag}] no page errors {errs[:3]}')
    br.close()

with sync_playwright() as pw:
    run(pw, 390, 844, 'phone')
    run(pw, 820, 1180, 'ipad')
srv.shutdown()
print('\nFAILURES:', len(fails)); [print(' -', f) for f in fails]
sys.exit(1 if fails else 0)
