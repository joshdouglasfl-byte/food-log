/**
 * Food Log API — bound to the Food_Log Google Sheet (open the sheet > Extensions > Apps Script).
 * Deploy > Manage deployments > edit > New version (Execute as: Me, Who has access: Anyone).
 *
 * Keys (never in this repo): Script Properties, made by running newKeys() from the editor.
 *   KEYS      {"<key>": {"p": "Josh", "t": "<made>"}}  app keys; the person comes from the key, not the request
 *   HAE_KEYS  same shape; Health Auto Export only (haeWorkouts), nothing else
 *   API_KEY   old shared key, still accepted until dropOldKeys() runs (sets LEGACY_OFF)
 * Rotate: newKeys() -> open the new links on each device / paste new HAE URLs -> dropOldKeys().
 * No key configured = every call refused.
 */

const TABS = { profiles: 'Profiles', foods: 'Foods', meals: 'Meals', log: 'Log',
  exercise: 'Exercise', days: 'Days', body: 'Body', plan: 'Plan' };
const LOG_DAYS = 365;      // history sent to the app for suggestions
const TZ = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'America/New_York';

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  // Health Auto Export (iPhone) can't send our JSON shape, so its key/person ride in the URL: ?source=hae&person=Josh&key=...
  const q = (e && e.parameter) || {};
  if (q.source === 'hae') return handle_({ action: 'haeWorkouts', key: q.key, person: q.person, hae: body });
  return handle_(body);
}

// ---------- keys ----------
const PEOPLE = ['Josh', 'Michelle'];
const APP_URL = 'https://joshdouglasfl-byte.github.io/food-log/';
function keyMap_(name) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(name) || '{}'); } catch (e) { return {}; }
}
/** -> {person, hae, legacy} or null. Fails closed: no key configured means nobody gets in. */
function auth_(p) {
  const k = String(p.key || ''); if (!k) return null;
  const props = PropertiesService.getScriptProperties();
  const app = keyMap_('KEYS')[k];
  if (app && PEOPLE.indexOf(app.p) >= 0) return { person: app.p, hae: false, legacy: false };
  const hae = keyMap_('HAE_KEYS')[k];
  if (hae && PEOPLE.indexOf(hae.p) >= 0) return { person: hae.p, hae: true, legacy: false };
  const old = props.getProperty('API_KEY');
  if (old && !props.getProperty('LEGACY_OFF') && k === old) {
    return PEOPLE.indexOf(p.person) >= 0 ? { person: p.person, hae: false, legacy: true } : { person: null, hae: false, legacy: true };
  }
  return null;
}
function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }   // 64 hex chars
/** Run from the editor: adds a fresh app key and HAE key for each person (old keys keep working) and logs the new links. */
function newKeys() {
  const props = PropertiesService.getScriptProperties(), t = new Date().toISOString();
  const keys = keyMap_('KEYS'), hae = keyMap_('HAE_KEYS'), url = ScriptApp.getService().getUrl();
  PEOPLE.forEach(person => {
    const a = newKey_(), h = newKey_();
    keys[a] = { p: person, t: t }; hae[h] = { p: person, t: t };
    Logger.log(`${person} setup link (open on each of ${person}'s devices, then Add to Home Screen):\n${APP_URL}${person.toLowerCase()}/#k=${a}`);
    Logger.log(`${person} Health Auto Export URL (paste into the REST API automation on ${person}'s iPhone):\n${url}?source=hae&person=${person}&key=${h}`);
  });
  props.setProperty('KEYS', JSON.stringify(keys)); props.setProperty('HAE_KEYS', JSON.stringify(hae));
}
/** Run from the editor once every device uses the new links: keeps only each person's newest keys and turns the old shared key off. */
function dropOldKeys() {
  const props = PropertiesService.getScriptProperties();
  ['KEYS', 'HAE_KEYS'].forEach(name => {
    const m = keyMap_(name), newest = {};
    Object.keys(m).forEach(k => { const o = m[k]; if (!newest[o.p] || o.t > m[newest[o.p]].t) newest[o.p] = k; });
    const keep = {}; Object.keys(newest).forEach(person => { keep[newest[person]] = m[newest[person]]; });
    props.setProperty(name, JSON.stringify(keep));
  });
  props.deleteProperty('API_KEY'); props.setProperty('LEGACY_OFF', '1');
  Logger.log('Old keys removed. Kept: ' + Object.values(keyMap_('KEYS')).map(o => o.p + ' ' + o.t).join(', '));
}

// ---------- what each action may touch ----------
// Generic actions only reach these tabs. Per-person tabs (with a Person column) are limited to the caller's rows.
const GENERIC_TABS = {
  read: ['Exercise', 'Exercises', 'Log', 'Coach Notes', 'Servings', 'Body', 'Day Plans'],
  append: ['Servings', 'Meals', 'Exercises', 'Feedback', 'Day Plans'],
  update: ['Coach Notes', 'Foods', 'Meals', 'Exercise', 'Log', 'Day Plans'],
  delete: ['Meals', 'Day Plans'],
  updateWhere: ['Log']
};
const CREATABLE_TABS = ['Day Plans'];   // append may create these if missing

function handle_(p) {
  const a = auth_(p);
  if (!a) return out_({ ok: false, error: 'unauthorized' });
  if (a.hae !== (p.action === 'haeWorkouts') && !a.legacy) return out_({ ok: false, error: 'unauthorized' });
  if (!a.person) return out_({ ok: false, error: 'person required' });
  p.person = a.person;   // never trust a person sent by the caller
  if (GENERIC_TABS[p.action] && GENERIC_TABS[p.action].indexOf(p.tab) < 0) return out_({ ok: false, error: 'tab not allowed' });
  const lock = LockService.getScriptLock();
  try {
    if (p.action !== 'bootstrap' && p.action !== 'foodSearch') lock.waitLock(20000);   // search reads nothing from the sheet
    switch (p.action) {
      case 'bootstrap': return out_(bootstrap_(p.person));
      case 'addLog': return out_(addLog_(p));
      case 'updateLog': return out_(updateLog_(p));
      case 'deleteLog': return out_(deleteLog_(p));
      case 'addFood': return out_(addFood_(p));
      case 'addExercise': return out_(addExercise_(p));
      case 'deleteExercise': return out_(deleteExercise_(p));
      case 'setDay': return out_(setDay_(p));
      case 'saveSettings': return out_(saveSettings_(p));
      case 'addFeedback': return out_(addFeedback_(p));
      case 'haeWorkouts': return out_(haeWorkouts_(p));
      case 'foodSearch': return out_(foodSearch_(p));
      // generic actions: new features use these, so the script rarely needs redeploying
      case 'read': return out_(gRead_(p));
      case 'readWB': return out_(wbRead_(p));
      case 'append': return out_(gAppend_(p));
      case 'update': return out_(gUpdate_(p));
      case 'delete': return out_(gDelete_(p));
      case 'updateWhere': return out_(gUpdateWhere_(p));
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- helpers ----------
function sh_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }
function ymd_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d || ''); }
// Dates are written as 'yyyy-mm-dd' text, which the sheet parses in its own time zone.
// (A Date object built here would use the script's time zone and can land on the previous day.)
function toDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : s; }
function rows_(name) {
  const s = sh_(name); const v = s.getDataRange().getValues();
  const h = v.shift(); return { sheet: s, header: h, rows: v };
}
function col_(header, name) {
  const i = header.indexOf(name); if (i < 0) throw new Error('missing column ' + name); return i;
}
function newId_(prefix) { return prefix + Utilities.getUuid().slice(0, 8); }
/** Row r (1-based) belongs to person, or the tab has no Person column (shared tab). Blank Person counts as Josh. */
function ownsRow_(s, r, person) {
  const pi = gHeader_(s).indexOf('Person'); if (pi < 0) return true;
  return (String(s.getRange(r, pi + 1).getValue()).trim() || 'Josh') === person;
}
/** Typed text is stored as text: a value starting with = + @ (or - not followed by a number) would otherwise run as a formula. */
function safe_(v) {
  return typeof v === 'string' && /^(=|\+|@|-(?![\d.]))/.test(v) ? "'" + v : v;
}
const safeRow_ = row => row.map(safe_);

/** Ensure Log/Exercise have an ID column for app-written rows. */
function ensureIdCol_(name, colName) {
  const s = sh_(name); const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  let i = h.indexOf(colName);
  if (i < 0) {
    i = h.length;
    if (i + 1 > s.getMaxColumns()) s.insertColumnsAfter(s.getMaxColumns(), 1);
    s.getRange(1, i + 1).setValue(colName)
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2F5D50');
  }
  return i + 1; // 1-based
}

function findRowById_(name, colName, id) {
  const c = ensureIdCol_(name, colName); const s = sh_(name);
  const hit = s.getRange(2, c, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

// ---------- bootstrap ----------
function bootstrap_(person) {
  if (!person) return { ok: false, error: 'person required' };
  const since = new Date(); since.setDate(since.getDate() - LOG_DAYS);

  const P = rows_(TABS.profiles);
  const pr = P.rows.find(r => r[0] === person);
  const profile = pr ? Object.fromEntries(P.header.map((h, i) => [h, h === 'Birthday' ? ymd_(pr[i]) : pr[i]])) : null;

  const F = rows_(TABS.foods);
  const foods = F.rows.filter(r => r[0]).map(r => ({
    id: r[0], name: r[1], brand: r[2], unit: r[3], per: Number(r[4]) || 1, cal: Number(r[5]) || 0,
    pro: num_(r[6]), fib: num_(r[7]), carb: num_(r[8]), fat: num_(r[9]), barcode: r[10], est: r[12] === 'Yes'
  }));

  const M = rows_(TABS.meals);
  const meals = M.rows.filter(r => r[0]).map(r => ({ id: r[0], name: r[1], items: r[2], cal: num_(r[3]) }));

  ensureIdCol_(TABS.log, 'EntryID');
  const L = rows_(TABS.log);
  const log = L.rows.filter(r => r[2] === person && r[0] instanceof Date && r[0] >= since).map(r => ({
    date: ymd_(r[0]), time: r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'HH:mm') : String(r[1] || ''),
    food: r[3], meal: r[4], name: r[5], qty: num_(r[6]), unit: r[7], cal: num_(r[8]),
    pro: num_(r[9]), fib: num_(r[10]), carb: num_(r[11]), fat: num_(r[12]), est: r[13] === 'Yes', id: r[14] || ''
  }));

  ensureIdCol_(TABS.exercise, 'EntryID');
  const E = rows_(TABS.exercise);
  const exercise = E.rows.filter(r => r[1] === person && r[0] instanceof Date && r[0] >= since).map(r => ({
    date: ymd_(r[0]), name: r[2], min: num_(r[3]), cal: num_(r[4]), source: r[5], id: r[6] || ''
  }));

  const D = rows_(TABS.days);
  const days = D.rows.filter(r => r[1] === person && r[0] instanceof Date).map(r => ({
    date: ymd_(r[0]), budget: num_(r[2]), eaten: num_(r[3]), ex: num_(r[4]), done: r[6] === 'Yes', water: num_(r[7])
  }));

  const B = rows_(TABS.body);
  const body = B.rows.filter(r => r[1] === person && r[0] instanceof Date).slice(-60).map(r => ({
    date: ymd_(r[0]), weight: num_(r[2]), fatPct: num_(r[3]), fatLb: num_(r[4])
  }));

  const PL = rows_(TABS.plan);
  const plan = PL.rows.filter(r => r[1] === person && r[0] instanceof Date).map(r => ({
    date: ymd_(r[0]), target: num_(r[2]), meals: r[3], notes: r[4]
  }));

  return { ok: true, person, profile, foods, meals, log, exercise, days, body, plan, serverTime: new Date().toISOString() };
}
function num_(v) { return v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v); }

// ---------- days ----------
/** Make sure a Days row exists for person+date; returns its 1-based row. */
function ensureDay_(person, date, budget) {
  const s = sh_(TABS.days); const v = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 2).getValues();
  for (let i = v.length - 1; i >= 0; i--) {
    if (ymd_(v[i][0]) === date && v[i][1] === person) return i + 2;
  }
  const r = s.getLastRow() + 1;
  const b = budget || lastBudget_(person);
  s.getRange(r, 1, 1, 8).setValues([[toDate_(date), person, b,
    `=SUMIFS(Log!$I:$I,Log!$A:$A,A${r},Log!$C:$C,B${r})`,
    `=SUMIFS(Exercise!$E:$E,Exercise!$A:$A,A${r},Exercise!$B:$B,B${r})`,
    `=C${r}+E${r}-D${r}`, 'No', '']]);
  s.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
  return r;
}
function lastBudget_(person) {
  const s = sh_(TABS.days); const v = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 3).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (v[i][1] === person && v[i][2]) return v[i][2];
  return 2000;
}

function setDay_(p) {
  const r = ensureDay_(p.person, p.date, p.budget);
  const s = sh_(TABS.days);
  if (p.done !== undefined) s.getRange(r, 7).setValue(p.done ? 'Yes' : 'No');
  if (p.water !== undefined) s.getRange(r, 8).setValue(p.water);
  if (p.budget) s.getRange(r, 3).setValue(p.budget);
  return { ok: true };
}

// ---------- log ----------
function addLog_(p) {
  const c = ensureIdCol_(TABS.log, 'EntryID');
  const s = sh_(TABS.log);
  const ids = [];
  const vals = (p.entries || []).map(e => {
    const id = e.id || newId_('L'); ids.push(id);
    const row = [toDate_(e.date), e.time || '', p.person, e.food || '', e.meal, e.name, e.qty, e.unit, e.cal,
      e.pro, e.fib, e.carb, e.fat, e.est ? 'Yes' : 'No'];
    while (row.length < c - 1) row.push('');
    row.push(id); return safeRow_(row);
  });
  if (!vals.length) return { ok: true, ids };
  // skip entries already written (retries from the offline queue)
  const existing = new Set(s.getRange(2, c, Math.max(s.getLastRow() - 1, 1), 1).getValues().flat().filter(String));
  const fresh = vals.filter(r => !existing.has(r[r.length - 1]));
  if (fresh.length) {
    const start = s.getLastRow() + 1;
    s.getRange(start, 1, fresh.length, fresh[0].length).setValues(fresh);
    s.getRange(start, 1, fresh.length, 1).setNumberFormat('yyyy-mm-dd');
  }
  [...new Set((p.entries || []).map(e => e.date))].forEach(d => ensureDay_(p.person, d, p.budget));
  return { ok: true, ids };
}

function updateLog_(p) {
  const r = findRowById_(TABS.log, 'EntryID', p.id);
  if (!r || !ownsRow_(sh_(TABS.log), r, p.person)) return { ok: false, error: 'not found' };
  const e = p.entry, s = sh_(TABS.log);
  s.getRange(r, 5, 1, 10).setValues([safeRow_([e.meal, e.name, e.qty, e.unit, e.cal, e.pro, e.fib, e.carb, e.fat, e.est ? 'Yes' : 'No'])]);
  if (e.food !== undefined) s.getRange(r, 4).setValue(safe_(e.food));
  return { ok: true };
}

function deleteLog_(p) {
  const r = findRowById_(TABS.log, 'EntryID', p.id);
  if (r && ownsRow_(sh_(TABS.log), r, p.person)) sh_(TABS.log).deleteRow(r);
  return { ok: true };
}

// ---------- foods ----------
function addFood_(p) {
  const s = sh_(TABS.foods); const f = p.food;
  const ids = s.getRange(2, 1, Math.max(s.getLastRow() - 1, 1), 1).getValues().flat();
  if (f.id && ids.indexOf(f.id) >= 0) return { ok: true, id: f.id };
  const max = ids.reduce((m, x) => Math.max(m, Number(String(x).slice(1)) || 0), 0);
  const id = 'F' + String(max + 1).padStart(5, '0');
  const r = s.getLastRow() + 1;
  s.getRange(r, 1, 1, 15).setValues([safeRow_([id, f.name, f.brand || '', f.unit, f.per || 1, f.cal, f.pro, f.fib, f.carb, f.fat,
    f.barcode || '', f.source || 'App', f.est ? 'Yes' : 'No', 0, ''])]);
  // Times used / Last used are plain values (formulas slowed the sheet); the app works these out from Log.
  return { ok: true, id };
}

// ---------- exercise ----------
function addExercise_(p) {
  const c = ensureIdCol_(TABS.exercise, 'EntryID'); const s = sh_(TABS.exercise); const e = p.entry;
  const id = e.id || newId_('X');
  if (findRowById_(TABS.exercise, 'EntryID', id)) return { ok: true, id };
  const row = [toDate_(e.date), p.person, e.name, e.min || '', e.cal, e.source || 'Manual'];
  while (row.length < c - 1) row.push('');
  row.push(id);
  const r = s.getLastRow() + 1;
  s.getRange(r, 1, 1, row.length).setValues([safeRow_(row)]); s.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
  ensureDay_(p.person, e.date, p.budget);
  return { ok: true, id };
}
// ---------- Apple Watch workouts from Health Auto Export ----------
// Watch workout name -> Food Log activity. Names not listed are kept as the watch names them.
const HAE_ACTIVITY = {
  'Traditional Strength Training': 'Weight Lifting', 'Functional Strength Training': 'Weight Lifting',
  'Outdoor Cycle': 'Bicycling', 'Indoor Cycle': 'Bicycling', 'Outdoor Cycling': 'Bicycling', 'Indoor Cycling': 'Bicycling', 'Cycling': 'Bicycling',
  'Golf': 'Golf', 'Outdoor Walk': 'Walking', 'Indoor Walk': 'Walking', 'Outdoor Walking': 'Walking', 'Indoor Walking': 'Walking', 'Walking': 'Walking',
  'Elliptical': 'Elliptical', 'Outdoor Run': 'Run neighborhood', 'Outdoor Running': 'Run neighborhood', 'Running': 'Run neighborhood',
  'Core Training': 'Core Fusion', 'Bowling': 'Bowling', 'Fishing': 'Fishing'
};
// Watch workouts dated before this are never added: those days already came in from Lose It! history and Workout Buddy.
const HAE_SINCE = { Josh: '2026-11-21' };
/** Health Auto Export REST payload {data:{workouts:[...]}} -> Exercise rows (Source 'Apple Watch', id AW-<start>).
 *  Skipped: repeats, zero-length entries other apps write, days before HAE_SINCE, and workouts already logged another way. */
function haeWorkouts_(p) {
  if (p.person !== 'Josh' && p.person !== 'Michelle') return { ok: false, error: 'person must be Josh or Michelle' };
  const ws = (p.hae && p.hae.data && p.hae.data.workouts) || [];
  let added = 0, skipped = 0;
  const notes = [];
  let others = null;   // read once, only when needed
  ws.forEach(w => {
    const start = haeDate_(w.start), end = haeDate_(w.end);
    const cal = Math.round(haeKcal_(w.activeEnergyBurned) || haeKcal_(w.activeEnergy) || 0);
    const raw = String(w.name || '').trim();
    const note = `${raw} | ${w.start} | ${w.end} | ${w.duration} | ${cal}`;
    const skip = why => { skipped++; notes.push(note + ' | ' + why); };
    if (!start || cal <= 0) return skip('no start or calories');
    // Lose It! (and similar apps) write logged exercise into Health as zero-length workouts at 23:59:59: not watch data
    if (!end || end <= start) return skip('zero-length (another app)');
    const secs = Number(w.duration) || (end ? (end - start) / 1000 : 0);
    const min = Math.max(1, Math.round(secs / 60));
    const local = haeLocal_(w.start, start);   // the workout's own local date/time (not the sheet's time zone)
    if (HAE_SINCE[p.person] && local.date < HAE_SINCE[p.person]) return skip('before ' + HAE_SINCE[p.person]);
    // Josh keeps AW-<stamp>; anyone else gets a -<initial> suffix so two people starting in the same minute don't collide
    const id = 'AW-' + local.stamp + (p.person === 'Josh' ? '' : '-' + p.person.charAt(0));
    const name = HAE_ACTIVITY[raw] || raw || 'Workout';
    if (findRowById_(TABS.exercise, 'EntryID', id)) return skip('already added');
    if (p.person !== 'Josh' && haeLegacyRow_(p.person, 'AW-' + local.stamp)) return skip('already added (old id)');   // added before 2026-11-22 without the suffix
    if (!others) others = haeOtherRows_(p.person);
    const dup = haeMatch_(others, local.date, name, min, cal);
    if (dup) { dup.used = true; return skip('already logged as ' + dup.id); }
    addExercise_({ person: p.person, entry: { id, date: local.date, name, min, cal, source: 'Apple Watch' } });
    notes.push(note + ' | added');
    added++;
  });
  haeLog_(p.person, ws.length, added, notes);
  return { ok: true, received: ws.length, added, skipped };
}
// Done exercise this person logged some other way (Workout Buddy, Lose It! history, typed in): not watch rows, not planned rows
function haeOtherRows_(person) {
  const s = sh_(TABS.exercise); if (s.getLastRow() < 2) return [];
  const h = gHeader_(s), v = s.getRange(2, 1, s.getLastRow() - 1, h.length).getValues();
  const ix = k => h.indexOf(k);
  const iD = ix('Date'), iP = ix('Person'), iA = ix('Activity'), iM = ix('Minutes'), iC = ix('Calories'), iS = ix('Source'), iE = ix('EntryID'), iPl = ix('Planned');
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return v.filter(r => r[iP] === person).map(r => {
    const src = String(r[iS] || ''), pl = iPl < 0 ? '' : String(r[iPl] || ''), date = ymd_(r[iD]);
    const planned = pl === 'Yes' || (pl === '' && (date > today || /plan/i.test(src)));
    return { date, key: haeKey_(r[iA], src), min: num_(r[iM]), cal: num_(r[iC]), id: String(r[iE] || ''), skip: src === 'Apple Watch' || planned };
  }).filter(o => !o.skip && o.cal);
}
// Activities that count as the same thing (Workout Buddy sessions are lifting; golf variants are golf)
function haeKey_(activity, source) {
  const a = String(activity || '').toLowerCase();
  if (source === 'Workout Buddy' || /weight|strength|lift/.test(a)) return 'lift';
  if (/golf/.test(a) && !/range/.test(a)) return 'golf';
  if (/cycl|bik/.test(a)) return 'bike';
  if (/walk/.test(a)) return 'walk';
  if (/run/.test(a)) return 'run';
  return a;
}
// One existing row per watch workout: same day, same activity, calories within 10% (at least 10), minutes within 20% (at least 5)
function haeMatch_(others, date, name, min, cal) {
  const key = haeKey_(name, ''); let best = null, bestD = 1e9;
  others.forEach(o => {
    if (o.used || o.date !== date || o.key !== key) return;
    const dc = Math.abs(o.cal - cal);
    if (dc > Math.max(10, cal * 0.1)) return;
    if (o.min && Math.abs(o.min - min) > Math.max(5, min * 0.2)) return;
    if (dc < bestD) { best = o; bestD = dc; }
  });
  return best;
}
// true when this person already has a row with the old (unsuffixed) id
function haeLegacyRow_(person, id) {
  const s = sh_(TABS.exercise); const c = ensureIdCol_(TABS.exercise, 'EntryID');
  const hits = s.getRange(2, c, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(id).matchEntireCell(true).findAll();
  return hits.some(h => s.getRange(h.getRow(), 2).getValue() === person);
}
// Date and yyyyMMddHHmm as written in the workout's own time ("2026-11-21 08:09:00 -0500"), else in Eastern time
function haeLocal_(s, d) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, stamp: m[1] + m[2] + m[3] + m[4] + m[5] };
  return { date: Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'), stamp: Utilities.formatDate(d, 'America/New_York', 'yyyyMMddHHmm') };
}
// Troubleshooting: one row per Health Auto Export post in HAE_Log (kept to the last 200)
function haeLog_(person, n, added, notes) {
  try {
    const ss = SpreadsheetApp.getActive();
    const s = ss.getSheetByName('HAE_Log') || ss.insertSheet('HAE_Log');
    if (s.getLastRow() === 0) s.appendRow(['Received', 'Person', 'Workouts', 'Added', 'Name | start | end | duration | kcal']);
    s.appendRow(safeRow_([Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm:ss'), person, n, added, notes.join('\n').slice(0, 45000)]));
    if (s.getLastRow() > 201) s.deleteRows(2, s.getLastRow() - 201);
  } catch (e) {}
}
// "2026-11-21 10:05:00 -0500" (or ISO) -> Date
function haeDate_(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})?$/);
  const d = m ? new Date(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}${m[3]}:${m[4] || '00'}`) : new Date(s);
  return isNaN(d) ? null : d;
}
// {qty, units} (kcal or kJ), or a list of samples to add up
function haeKcal_(v) {
  if (!v) return 0;
  if (Array.isArray(v)) return v.reduce((t, x) => t + haeKcal_(x), 0);
  const q = Number(v.qty) || 0;
  return /kj/i.test(String(v.units || '')) ? q / 4.184 : q;
}

function deleteExercise_(p) {
  const r = findRowById_(TABS.exercise, 'EntryID', p.id);
  if (r && ownsRow_(sh_(TABS.exercise), r, p.person)) sh_(TABS.exercise).deleteRow(r);
  return { ok: true };
}

// ---------- settings ----------
function saveSettings_(p) {
  const P = rows_(TABS.profiles);
  const i = P.rows.findIndex(r => r[0] === p.person);
  if (i < 0) return { ok: false, error: 'no profile' };
  Object.entries(p.settings || {}).forEach(([k, v]) => {
    const c = P.header.indexOf(k);
    if (c >= 0 && k !== 'Person') P.sheet.getRange(i + 2, c + 1).setValue(safe_(v));
  });
  return { ok: true };
}

// ---------- feedback ("Tell my dietitian" / "Tell my developer") ----------
function addFeedback_(p) {
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName('Feedback');
  if (!s) {
    s = ss.insertSheet('Feedback');
    s.getRange(1, 1, 1, 7).setValues([['Date', 'Time', 'Person', 'For', 'Message', 'Status', 'EntryID']])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2F5D50');
    s.setFrozenRows(1); s.setColumnWidth(5, 480);
  }
  const f = p.entry;
  const ids = s.getRange(1, 7, s.getLastRow(), 1).getValues().flat();
  if (ids.indexOf(f.id) >= 0) return { ok: true };
  const r = s.getLastRow() + 1;
  s.getRange(r, 1, 1, 7).setValues([safeRow_([toDate_(f.date), f.time, p.person, f.to, f.message, 'New', f.id])]);
  s.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
  return { ok: true };
}

// ---------- generic table API ----------
// Rows are objects keyed by header name. The ID column is "EntryID", "ID", or a first column ending in "ID".
// A string value starting with "=" is written as a formula; "{r}" in it becomes the row number.
function gSheet_(tab, headers) {
  if (!tab || /[\[\]*?:\/\\]/.test(tab)) throw new Error('bad tab');
  const ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(tab);
  if (!s) {
    if (!headers || !headers.length) throw new Error('no such tab: ' + tab);
    s = ss.insertSheet(tab);
    s.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2F5D50');
    s.setFrozenRows(1);
  }
  return s;
}
function gHeader_(s) { return s.getRange(1, 1, 1, Math.max(s.getLastColumn(), 1)).getValues()[0].map(String); }
function gIdCol_(h) {
  let i = h.indexOf('EntryID'); if (i < 0) i = h.indexOf('ID');
  if (i < 0 && /ID$/.test(h[0])) i = 0;
  return i; // 0-based, -1 if none
}
function gAddCols_(s, h, keys) {
  keys.filter(k => h.indexOf(k) < 0).forEach(k => {
    if (h.length + 1 > s.getMaxColumns()) s.insertColumnsAfter(s.getMaxColumns(), 1);
    s.getRange(1, h.length + 1).setValue(k).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#2F5D50');
    h.push(k);
  });
  return h;
}
// A formula must be sent as {f: '=...'} ("{r}" becomes the row); plain strings starting with = are stored as text.
// Formulas that reach the web (IMPORT*, IMAGE, HYPERLINK) are refused.
function gCell_(v, r) {
  if (v && typeof v === 'object' && typeof v.f === 'string' && v.f.charAt(0) === '=') {
    if (/IMPORT|IMAGE|HYPERLINK|WEBSERVICE/i.test(v.f)) throw new Error('formula not allowed');
    return v.f.replace(/\{r\}/g, r);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return toDate_(v);
  return v === null || v === undefined ? '' : safe_(v);
}
function gOut_(v) { return v instanceof Date ? (v.getHours() || v.getMinutes() ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm") : ymd_(v)) : v; }

/** readWB: {tab (default Sets), person?, since?, limit?} -> rows from the Workout Buddy sheet, read-only.
 *  Blank Person there means Josh. Lets Food Log show a weight session's sets without the Workout Buddy key. */
const WB_SHEET_ID = '1hmU_XKOhSxIM_eculF_hw0agBoI6TKY7EnNb10x5go0';
const WB_TABS = ['Sets', 'Progress', 'Exercises'];
function wbRead_(p) {
  const tab = p.tab || 'Sets';
  if (WB_TABS.indexOf(tab) < 0) return { ok: false, error: 'tab not allowed' };
  const s = SpreadsheetApp.openById(WB_SHEET_ID).getSheetByName(tab); if (!s) return { ok: true, rows: [] };
  const v = s.getDataRange().getValues(); const h = v.shift().map(String);
  const pi = h.indexOf('Person'), di = h.indexOf('Date');
  let rows = v.filter(r => r.some(x => x !== ''));
  if (p.person && pi >= 0) rows = rows.filter(r => (r[pi] || 'Josh') === p.person);
  if (p.since && di >= 0) rows = rows.filter(r => ymd_(r[di]) >= p.since);
  if (p.limit) rows = rows.slice(-p.limit);
  return { ok: true, header: h, rows: rows.map(r => Object.fromEntries(h.map((k, i) => [k, gOut_(r[i])]))) };
}

/** read: {tab, person?, since?, limit?} -> rows as objects */
function gRead_(p) {
  const s = gSheet_(p.tab); const v = s.getDataRange().getValues(); const h = v.shift().map(String);
  const pi = h.indexOf('Person'), di = h.indexOf('Date');
  let rows = v.filter(r => r.some(x => x !== ''));
  if (pi >= 0) rows = rows.filter(r => (String(r[pi]).trim() || 'Josh') === p.person);
  if (p.since && di >= 0) rows = rows.filter(r => ymd_(r[di]) >= p.since);
  if (p.limit) rows = rows.slice(-p.limit);
  return { ok: true, header: h, rows: rows.map(r => Object.fromEntries(h.map((k, i) => [k, gOut_(r[i])]))) };
}

/** append: {tab, rows:[{Header: value}], headers?: [...] (to create the tab)} ; skips IDs already present */
function gAppend_(p) {
  const rows = p.rows || []; if (!rows.length) return { ok: true, added: 0 };
  const s = gSheet_(p.tab, CREATABLE_TABS.indexOf(p.tab) >= 0 ? (p.headers || Object.keys(rows[0])) : null);
  let h = gAddCols_(s, gHeader_(s), [...new Set(rows.flatMap(Object.keys))]);
  if (h.indexOf('Person') >= 0) rows.forEach(o => { o.Person = p.person; });   // per-person tab: always the caller
  const ic = gIdCol_(h);
  const have = ic >= 0 && s.getLastRow() > 1 ? new Set(s.getRange(2, ic + 1, s.getLastRow() - 1, 1).getValues().flat().map(String)) : new Set();
  let r = s.getLastRow() + 1, added = 0;
  rows.forEach(o => {
    if (ic >= 0 && o[h[ic]] && have.has(String(o[h[ic]]))) return;
    s.getRange(r, 1, 1, h.length).setValues([h.map(k => gCell_(o[k], r))]);
    h.forEach((k, i) => { if (/^\d{4}-\d{2}-\d{2}$/.test(String(o[k] || ''))) s.getRange(r, i + 1).setNumberFormat('yyyy-mm-dd'); });
    r++; added++;
  });
  return { ok: true, added };
}

/** update: {tab, id, values:{Header: value}} */
function gUpdate_(p) {
  const s = gSheet_(p.tab); let h = gHeader_(s); const ic = gIdCol_(h);
  if (ic < 0) throw new Error('tab has no ID column');
  const hit = s.getRange(2, ic + 1, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(String(p.id)).matchEntireCell(true).findNext();
  if (!hit || !ownsRow_(s, hit.getRow(), p.person)) return { ok: false, error: 'not found' };
  const r = hit.getRow();
  if ('Person' in (p.values || {})) return { ok: false, error: 'Person cannot be changed' };
  h = gAddCols_(s, h, Object.keys(p.values || {}));
  Object.entries(p.values || {}).forEach(([k, v]) => s.getRange(r, h.indexOf(k) + 1).setValue(gCell_(v, r)));
  return { ok: true };
}

/** updateWhere: {tab, match:{Header: value}, values:{Header: value}} -> sets values on every row whose match cells all equal (as text).
 *  Writes only the value columns, in one go each. Used to rename a food across all Log rows. */
function gUpdateWhere_(p) {
  const s = gSheet_(p.tab); const h = gHeader_(s);
  const m = Object.entries(p.match || {}); if (!m.length) throw new Error('match required');
  const keys = Object.keys(p.values || {}); if (!keys.length) return { ok: true, updated: 0 };
  // only use today: rename a food on every Log row with its FoodID (both people, by Josh's choice)
  if (m.length !== 1 || m[0][0] !== 'FoodID' || !String(m[0][1]) || keys.some(k => k !== 'Food')) throw new Error('updateWhere: only {match:{FoodID}, values:{Food}}');
  const n = s.getLastRow() - 1; if (n < 1) return { ok: true, updated: 0 };
  const mc = m.map(([k, v]) => [col_(h, k), String(v)]);
  const cols = {}; mc.forEach(([c]) => { cols[c] = s.getRange(2, c + 1, n, 1).getValues(); });
  const hit = []; for (let i = 0; i < n; i++) if (mc.every(([c, v]) => String(cols[c][i][0]) === v)) hit.push(i);
  if (!hit.length) return { ok: true, updated: 0 };
  keys.forEach(k => {
    const c = col_(h, k), rg = s.getRange(2, c + 1, n, 1), vals = rg.getValues();
    hit.forEach(i => { vals[i][0] = gCell_(p.values[k], i + 2); });
    rg.setValues(vals);
  });
  return { ok: true, updated: hit.length };
}

/** delete: {tab, id} */
function gDelete_(p) {
  const s = gSheet_(p.tab); const ic = gIdCol_(gHeader_(s));
  if (ic < 0) throw new Error('tab has no ID column');
  const hit = s.getRange(2, ic + 1, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(String(p.id)).matchEntireCell(true).findNext();
  if (hit && ownsRow_(s, hit.getRow(), p.person)) s.deleteRow(hit.getRow());
  return { ok: true };
}


// ---------- USDA FoodData Central search (type-ahead in the food list) ----------
// The key lives in Script Property FDC_KEY (never in the repo). Results cached 6 h per query.
const FDC_NUM = { cal: ['208', '957', '958'], pro: ['203'], fib: ['291'], carb: ['205'], fat: ['204'] };
function foodSearch_(p) {
  const q = String(p.q || '').trim().toLowerCase().slice(0, 60);
  if (q.length < 3) return { ok: true, foods: [] };
  const cache = CacheService.getScriptCache(), ck = 'fdc:' + q;
  const hit = cache.get(ck); if (hit) return { ok: true, foods: JSON.parse(hit), cached: true };
  const key = PropertiesService.getScriptProperties().getProperty('FDC_KEY') || 'DEMO_KEY';
  const res = UrlFetchApp.fetch('https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(key), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ query: q, pageSize: 25, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }) });
  if (res.getResponseCode() !== 200) return { ok: false, error: 'USDA search ' + res.getResponseCode() };
  const foods = fdcFoods_(JSON.parse(res.getContentText()).foods || []);
  try { cache.put(ck, JSON.stringify(foods), 21600); } catch (e) {}
  return { ok: true, foods: foods };
}
function fdcFoods_(list) {
  const out = [], seen = {};
  list.forEach(function (f) {
    const n = {};
    (f.foodNutrients || []).forEach(function (x) {
      const num = String(x.nutrientNumber || '');
      Object.keys(FDC_NUM).forEach(function (k) {
        if (n[k] == null && FDC_NUM[k].indexOf(num) >= 0 && (k !== 'cal' || String(x.unitName).toUpperCase() === 'KCAL')) n[k] = Number(x.value);
      });
    });
    if (n.cal == null) return;
    const brand = String(f.brandName || f.brandOwner || '').trim();
    const name = String(f.description || '').trim();
    const sig = (name + '|' + brand).toLowerCase(); if (seen[sig]) return; seen[sig] = 1;
    const su = String(f.servingSizeUnit || '').toLowerCase();
    out.push({ fdcId: f.fdcId, name: name, brand: brand, type: f.dataType, per100: n,   // per 100 g (or ml)
      servingG: (su === 'g' || su === 'grm' || su === 'ml' || su === 'mlt') && f.servingSize ? Number(f.servingSize) : null,
      servingText: f.householdServingFullText || '' });
  });
  return out.slice(0, 15);
}

// Run once from the editor (pick it in the function menu, then Run) so Google asks for the "connect to an external service" permission USDA search needs.
function authorizeOutsideCalls() {
  UrlFetchApp.fetch('https://api.nal.usda.gov/fdc/v1/foods/search?api_key=DEMO_KEY&query=apple&pageSize=1', { muteHttpExceptions: true });
}
