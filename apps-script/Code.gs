/**
 * Food Log API — bound to the Food_Log Google Sheet.
 * Deploy: Extensions > Apps Script, paste this file, set Script Property API_KEY,
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

const TABS = { profiles: 'Profiles', foods: 'Foods', meals: 'Meals', log: 'Log',
  exercise: 'Exercise', days: 'Days', body: 'Body', plan: 'Plan' };
const LOG_DAYS = 365;      // history sent to the app for suggestions
const TZ = 'America/New_York';

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
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
function toDate_(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
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
    f.barcode || '', f.source || 'App', f.est ? 'Yes' : 'No',
    `=COUNTIF(Log!$D:$D,A${r})`, `=IF(N${r}=0,"",MAXIFS(Log!$A:$A,Log!$D:$D,A${r}))`]]);
  s.getRange(r, 15).setNumberFormat('yyyy-mm-dd');
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
