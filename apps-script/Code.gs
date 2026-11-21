/**
 * Food Log API — bound to the Food_Log Google Sheet.
 * Deploy: Extensions > Apps Script, paste this file, set Script Property API_KEY,
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
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

function handle_(p) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (key && p.key !== key) return out_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  try {
    if (p.action !== 'bootstrap') lock.waitLock(20000);
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
      // generic actions: new features use these, so the script rarely needs redeploying
      case 'read': return out_(gRead_(p));
      case 'append': return out_(gAppend_(p));
      case 'update': return out_(gUpdate_(p));
      case 'delete': return out_(gDelete_(p));
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

  return { ok: true, profile, foods, meals, log, exercise, days, body, plan, serverTime: new Date().toISOString() };
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
    row.push(id); return row;
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
  if (!r) return { ok: false, error: 'not found' };
  const e = p.entry, s = sh_(TABS.log);
  s.getRange(r, 5, 1, 10).setValues([[e.meal, e.name, e.qty, e.unit, e.cal, e.pro, e.fib, e.carb, e.fat, e.est ? 'Yes' : 'No']]);
  if (e.food !== undefined) s.getRange(r, 4).setValue(e.food);
  return { ok: true };
}

function deleteLog_(p) {
  const r = findRowById_(TABS.log, 'EntryID', p.id);
  if (r) sh_(TABS.log).deleteRow(r);
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
  s.getRange(r, 1, 1, 15).setValues([[id, f.name, f.brand || '', f.unit, f.per || 1, f.cal, f.pro, f.fib, f.carb, f.fat,
    f.barcode || '', f.source || 'App', f.est ? 'Yes' : 'No', 0, '']]);
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
  s.getRange(r, 1, 1, row.length).setValues([row]); s.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
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
/** Health Auto Export REST payload {data:{workouts:[...]}} -> Exercise rows (Source 'Apple Watch', id AW-<start>). Repeats are skipped. */
function haeWorkouts_(p) {
  if (p.person !== 'Josh' && p.person !== 'Michelle') return { ok: false, error: 'person must be Josh or Michelle' };
  const ws = (p.hae && p.hae.data && p.hae.data.workouts) || [];
  let added = 0, skipped = 0;
  const notes = [];
  ws.forEach(w => {
    const start = haeDate_(w.start), end = haeDate_(w.end);
    const cal = Math.round(haeKcal_(w.activeEnergyBurned) || haeKcal_(w.activeEnergy) || 0);
    const raw = String(w.name || '').trim();
    notes.push(`${raw} | ${w.start} | ${w.end} | ${w.duration} | ${cal}`);
    if (!start || cal <= 0) { skipped++; return; }
    // Lose It! (and similar apps) write logged exercise into Health as zero-length workouts at 23:59:59: not watch data
    if (!end || end <= start) { skipped++; return; }
    const secs = Number(w.duration) || (end ? (end - start) / 1000 : 0);
    const local = haeLocal_(w.start, start);   // the workout's own local date/time (not the sheet's time zone)
    const id = 'AW-' + local.stamp;
    const name = HAE_ACTIVITY[raw] || raw || 'Workout';
    if (findRowById_(TABS.exercise, 'EntryID', id)) { skipped++; return; }
    addExercise_({ person: p.person, entry: { id, date: local.date, name,
      min: Math.max(1, Math.round(secs / 60)), cal, source: 'Apple Watch' } });
    added++;
  });
  haeLog_(p.person, ws.length, added, notes);
  return { ok: true, received: ws.length, added, skipped };
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
    s.appendRow([Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm:ss'), person, n, added, notes.join('\n').slice(0, 45000)]);
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
  if (r) sh_(TABS.exercise).deleteRow(r);
  return { ok: true };
}

// ---------- settings ----------
function saveSettings_(p) {
  const P = rows_(TABS.profiles);
  const i = P.rows.findIndex(r => r[0] === p.person);
  if (i < 0) return { ok: false, error: 'no profile' };
  Object.entries(p.settings || {}).forEach(([k, v]) => {
    const c = P.header.indexOf(k);
    if (c >= 0) P.sheet.getRange(i + 2, c + 1).setValue(v);
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
  s.getRange(r, 1, 1, 7).setValues([[toDate_(f.date), f.time, p.person, f.to, f.message, 'New', f.id]]);
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
function gCell_(v, r) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return toDate_(v);
  if (typeof v === 'string' && v.charAt(0) === '=') return v.replace(/\{r\}/g, r);
  return v === null || v === undefined ? '' : v;
}
function gOut_(v) { return v instanceof Date ? (v.getHours() || v.getMinutes() ? Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm") : ymd_(v)) : v; }

/** read: {tab, person?, since?, limit?} -> rows as objects */
function gRead_(p) {
  const s = gSheet_(p.tab); const v = s.getDataRange().getValues(); const h = v.shift().map(String);
  const pi = h.indexOf('Person'), di = h.indexOf('Date');
  let rows = v.filter(r => r.some(x => x !== ''));
  if (p.person && pi >= 0) rows = rows.filter(r => r[pi] === p.person);
  if (p.since && di >= 0) rows = rows.filter(r => ymd_(r[di]) >= p.since);
  if (p.limit) rows = rows.slice(-p.limit);
  return { ok: true, header: h, rows: rows.map(r => Object.fromEntries(h.map((k, i) => [k, gOut_(r[i])]))) };
}

/** append: {tab, rows:[{Header: value}], headers?: [...] (to create the tab)} ; skips IDs already present */
function gAppend_(p) {
  const rows = p.rows || []; if (!rows.length) return { ok: true, added: 0 };
  const s = gSheet_(p.tab, p.headers || Object.keys(rows[0]));
  let h = gAddCols_(s, gHeader_(s), [...new Set(rows.flatMap(Object.keys))]);
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
  if (!hit) return { ok: false, error: 'not found' };
  const r = hit.getRow();
  h = gAddCols_(s, h, Object.keys(p.values || {}));
  Object.entries(p.values || {}).forEach(([k, v]) => s.getRange(r, h.indexOf(k) + 1).setValue(gCell_(v, r)));
  return { ok: true };
}

/** delete: {tab, id} */
function gDelete_(p) {
  const s = gSheet_(p.tab); const ic = gIdCol_(gHeader_(s));
  if (ic < 0) throw new Error('tab has no ID column');
  const hit = s.getRange(2, ic + 1, Math.max(s.getLastRow() - 1, 1), 1).createTextFinder(String(p.id)).matchEntireCell(true).findNext();
  if (hit) s.deleteRow(hit.getRow());
  return { ok: true };
}
