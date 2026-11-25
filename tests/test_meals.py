"""Playwright test for meal search and brand tags, API stubbed via page.route. Usage: python3 -I test_wiz.py <repo>"""
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

CALLS = []; PLANS = []; SLOW_COACH = [False]
NOTES = [dict(Date=D(-1), Time='3:00', Person='Josh', From='Dietitian', Message='Old note, already read.', Status='Read', EntryID='CN1'),
         dict(Date=D(0), Time='3:00', Person='Josh', From='Dietitian', Message='Macros for the last 7 days: protein short. Go get it!', Status='New', EntryID='CN2')]
def handle(route, request):
    _b = json.loads(request.post_data or '{}') if request.method == 'POST' else {}
    if request.method == 'GET' or _b.get('action') == 'bootstrap':   # bootstrap is a POST since 2026-11-24
        person = _b.get('person') or re.search(r'person=(\w+)', request.url).group(1)
        return route.fulfill(status=200, content_type='application/json', body=json.dumps(boot(person)))
    body = json.loads(request.post_data or '{}'); CALLS.append(body)
    a = body.get('action'); res = {'ok': True}
    if SLOW_COACH[0] and a == 'read' and body.get('tab') == 'Coach Notes': return route.abort()
    if a == 'append' and body.get('tab') == 'Day Plans': PLANS.extend(body['rows'])
    if a == 'delete' and body.get('tab') == 'Day Plans': PLANS[:] = [r for r in PLANS if r['PlanID'] != body['id']]
    if a == 'read':
        tab = body.get('tab')
        if tab == 'Servings': res['rows'] = [dict(FoodID='F12', Unit='Serving', Grams=28, EntryID='S1')]
        elif tab == 'Exercises': res['rows'] = [dict(ExerciseID='EX1', Activity='Bike ride', **{'Josh cal/min': 9, 'Michelle cal/min': 7}), dict(ExerciseID='EX2', Activity='Weightlifting', **{'Josh cal/min': 4.2})]
        elif tab == 'Coach Notes': res['rows'] = [r for r in NOTES if r['Person'] == body.get('person')] 
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


LOG.append(entry('F9', 1, 'Each', 'Lunch', D(0), i=9101))
for k, x in enumerate([('F7', 1, 'Each'), ('F18', 1, 'Cup'), ('F16', 1, 'Each')]): LOG.append(entry(x[0], x[1], x[2], 'Dinner', D(-340), i=9200 + k))

def run(pw, w, h, tag):
    br = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, timezone_id='America/New_York')
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.route(API + '*', handle); page.route(re.compile(r'.*cdn\.jsdelivr.*'), lambda r, q: r.abort())
    page.goto('http://127.0.0.1:8765/josh/?k=test'); page.wait_for_selector('nav.tabs'); page.wait_for_timeout(800)
    e = page.locator('.entry', has_text='McDouble').first
    check(e.locator('.brand').count() and "McDonald" in e.locator('.brand').inner_text(), f'{tag}: brand tag on day log entry')
    oat = page.locator('.entry', has_text='Oatmeal').first
    check(oat.locator('.brand').count() == 0, f'{tag}: no tag when brand unknown')
    page.locator('.entry', has_text='McDouble').first.evaluate("el => el.scrollIntoView({block: 'center'})"); page.wait_for_timeout(200); page.screenshot(path=f'{OUT}/meals_{tag}_day.png')
    page.click('[data-addslot=Dinner]'); page.wait_for_timeout(200); page.click('[data-tab=meals]'); page.wait_for_timeout(200)
    check(page.locator('#addres .pick').count() > 0, f'{tag}: meals list shows')
    check('Turkey Sandwich, Black beans' not in page.locator('#addres').inner_text(), f'{tag}: old meal hidden without search')
    page.fill('#q', 'turkey'); page.wait_for_timeout(500)
    txt = page.locator('#addres').inner_text()
    check('Turkey Sandwich, Black beans, Cookie' in txt and str(int(D(-340)[:4])) in txt, f'{tag}: search finds last year turkey meal with year')
    check(all('Turkey' in p.inner_text() for p in page.locator('#addres .pick').all()), f'{tag}: only turkey meals listed')
    check(page.locator('#q').evaluate('el => el === document.activeElement'), f'{tag}: search box keeps focus')
    page.screenshot(path=f'{OUT}/meals_{tag}_search.png')
    page.fill('#q', 'mcdonald'); page.wait_for_timeout(500)
    txt = page.locator('#addres').inner_text()
    check('McDouble Meal' in txt, f'{tag}: brand search finds saved meal')
    page.locator('#addres [data-smeal]').first.click(); page.wait_for_timeout(200)
    check('McDouble' in page.locator('.sheet').inner_text(), f'{tag}: tapping a found saved meal opens it')
    page.click('[data-m=back]'); page.wait_for_timeout(200)
    page.fill('#q', 'zzzz'); page.wait_for_timeout(500)
    check('No meals match' in page.locator('#addres').inner_text(), f'{tag}: empty search message')
    page.click('[data-tab=foods]'); page.wait_for_timeout(200)
    check(page.locator('#q').input_value() == 'zzzz', f'{tag}: meal search carries to My foods')
    page.fill('#q', 'turkey'); page.wait_for_timeout(500)
    page.click('[data-tab=meals]'); page.wait_for_timeout(300)
    check(page.locator('#q').input_value() == 'turkey' and 'Turkey Sandwich, Black beans' in page.locator('#addres').inner_text(), f'{tag}: food search carries to Meals and filters')
    check(not errs, f'{tag}: no page errors {errs[:2]}')
    br.close()

with sync_playwright() as pw:
    run(pw, 390, 844, 'phone'); run(pw, 820, 1180, 'ipad')
srv.shutdown()
print('FAILS:', fails) if fails else print('ALL PASS')
