/* Food Log — lightweight calorie log. Data lives in the Food_Log Google Sheet via Apps Script. */
(() => {
  'use strict';
  const PERSON = window.FL_PERSON;
  const CFG = window.FL_CONFIG || {};
  const ALL_SLOTS = ['Early Snacks', 'Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const LS = k => `fl-${PERSON}-${k}`;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r0 = n => Math.round(Number(n) || 0);
  const fmt = n => r0(n).toLocaleString();

  // ---------- dates ----------
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const isWeekend = s => [0, 6].includes(parse(s).getDay());
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dayLabel = s => {
    const t = today();
    if (s === t) return 'Today'; if (s === addDays(t, -1)) return 'Yesterday'; if (s === addDays(t, 1)) return 'Tomorrow';
    return parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // ---------- storage ----------
  const load = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch (e) {} };

  // API key: ?k=... on first visit, then remembered on this device
  (() => {
    const u = new URL(location.href); const k = u.searchParams.get('k');
    if (k) save('key', k);
  })();

  const state = {
    data: load('data', null), queue: load('queue', []), view: 'day', date: today(),
    weekOf: today(), syncing: false, error: '', modal: null
  };
  const uid = p => p + Math.random().toString(36).slice(2, 10);

  // ---------- API ----------
  async function api(action, body = {}) {
    if (!CFG.API_URL) throw new Error('API_URL not set in config.js');
    const payload = { action, key: load('key', ''), person: PERSON, ...body };
    const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'request failed');
    return j;
  }
  function enqueue(action, body) { state.queue.push({ action, body, qid: uid('q') }); save('queue', state.queue); flush(); }
  async function flush() {
    if (state.syncing || !state.queue.length) return;
    state.syncing = true; renderSync();
    try {
      while (state.queue.length) {
        const job = state.queue[0];
        const j = await api(job.action, job.body);
        if (job.action === 'addFood' && j.id && job.body.food.tempId) swapFoodId(job.body.food.tempId, j.id);
        state.queue.shift(); save('queue', state.queue);
      }
      state.error = '';
    } catch (e) { state.error = String(e.message || e); }
    state.syncing = false; renderSync();
  }
  function swapFoodId(tmp, real) {
    const d = state.data;
    d.foods.forEach(f => { if (f.id === tmp) f.id = real; });
    d.log.forEach(l => { if (l.food === tmp) l.food = real; });
    state.queue.forEach(q => (q.body.entries || []).forEach(e => { if (e.food === tmp) e.food = real; }));
    if (state.modal && state.modal.food === tmp) state.modal.food = real;
    persist();
  }
  async function refresh() {
    try {
      await flush();
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 45000);
      const res = await fetch(`${CFG.API_URL}?action=bootstrap&person=${encodeURIComponent(PERSON)}&key=${encodeURIComponent(load('key', ''))}`, { signal: ctl.signal }); clearTimeout(tm);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      if (state.queue.length) return; // don't overwrite unsynced local changes
      state.data = j; persist(); state.error = ''; syncBudgets(); render(); loadPlanned(); loadBody();
    } catch (e) { state.error = String(e.message || e); if (state.data) renderSync(); else render(); }
  }
  const persist = () => { save('data', state.data); idx = null; };
  // Planned flags live in the Log tab's Planned column; read today and later via the generic read action
  async function loadPlanned() {
    try {
      const j = await api('read', { tab: 'Log', since: today() });
      const flag = new Map(j.rows.filter(r => r.EntryID).map(r => [r.EntryID, r.Planned === 'Yes']));
      state.data.log.forEach(l => { if (l.id && flag.has(l.id)) l.planned = flag.get(l.id); });
      persist(); render();
    } catch (e) {}
  }
  async function loadBody() {
    try {
      const j = await api('read', { tab: 'Body' });
      state.data.bodyAll = j.rows.filter(r => r.Date && r['Weight (lb)'] !== '').map(r => ({
        date: String(r.Date).slice(0, 10), weight: Number(r['Weight (lb)']) || null,
        fatPct: r['Body fat (%)'] === '' ? null : Number(r['Body fat (%)']), fatLb: r['Fat mass (lb)'] === '' ? null : Number(r['Fat mass (lb)']) }))
        .sort((a, b) => a.date < b.date ? -1 : 1);
      persist(); if (state.view === 'settings') render();
    } catch (e) {}
  }
  const isPlanned = l => l.planned === true || (l.planned === undefined && l.date > today());

  // ---------- derived ----------
  let idx = null; // cached lookups
  function I() {
    if (idx) return idx;
    const d = state.data;
    const foodById = new Map(d.foods.map(f => [f.id, f]));
    const logByDate = new Map(); d.log.forEach(l => { if (!logByDate.has(l.date)) logByDate.set(l.date, []); logByDate.get(l.date).push(l); });
    const exByDate = new Map(); d.exercise.forEach(x => { if (!exByDate.has(x.date)) exByDate.set(x.date, []); exByDate.get(x.date).push(x); });
    const dayByDate = new Map(d.days.map(x => [x.date, x]));
    const planByDate = new Map(d.plan.map(x => [x.date, x]));
    return (idx = { foodById, logByDate, exByDate, dayByDate, planByDate });
  }
  const profile = () => state.data.profile || {};
  const visibleSlots = () => {
    const s = String(profile()['Meal slots'] || '').split(',').map(x => x.trim()).filter(Boolean);
    return s.length ? ALL_SLOTS.filter(x => s.includes(x)) : ALL_SLOTS;
  };
  const waterOn = () => profile()['Track water'] === 'Yes';
  // ---------- plan / targets ----------
  const GOALS = [-2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 1];
  function latestWeight(date) {
    const b = (state.data.body || []).filter(x => x.weight && x.date <= date).pop() || (state.data.body || []).filter(x => x.weight).pop();
    return b ? b.weight : null;
  }
  function planFor(date) {
    const p = profile(), wt = latestWeight(date);
    const h = Number(p['Height (in)']), bd = p['Birthday'], sex = String(p['Sex'] || '').toLowerCase();
    if (!wt || !h || !bd) return null;
    const d = parse(date), b = parse(bd);
    let age = d.getFullYear() - b.getFullYear(); if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
    const kg = wt * 0.453592, cm = h * 2.54;
    const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex.startsWith('f') ? -161 : 5);   // Mifflin-St Jeor
    const sedentary = bmr * 1.2;                                                     // sedentary
    const manual = Number(p['Manual adjustment (cal)']) || 0;                        // like Lose It!'s manual adjustment
    const burn = sedentary + manual;
    const goal = Number(p['Weekly goal (lb/week)']) || 0;
    const daily = goal * 3500 / 7;
    const wkndExtra = Number(p['Weekend adjustment (cal)']) || 0;
    const wkdayAdj = Number(p['Weekday adjustment (cal)']) || 0;
    const base = burn + daily;
    const target = base + (isWeekend(date) ? wkndExtra : wkdayAdj);
    return { age, wt, h, sex, bmr, sedentary, manual, burn, goal, daily, base, wkndExtra, wkdayAdj, target: Math.round(target) };
  }
  // Past days keep the budget they had; today and later use the plan (a dietitian Plan target overrides).
  function budgetFor(date) {
    const { dayByDate, planByDate } = I();
    if (planByDate.get(date)?.target) return planByDate.get(date).target;
    if (date >= today()) { const pl = planFor(date); if (pl) return pl.target; }
    if (dayByDate.get(date)?.budget) return dayByDate.get(date).budget;
    const prior = state.data.days.filter(x => x.date <= date && x.budget).pop() || state.data.days.filter(x => x.budget).pop();
    return prior ? prior.budget : 2000;
  }
  // Keep the sheet's Days budgets for today and later in step with the plan
  function syncBudgets() {
    const t = today();
    for (const d of state.data.days) {
      if (d.date < t) continue;
      const b = budgetFor(d.date);
      if (Math.abs((d.budget || 0) - b) >= 1) { d.budget = b; enqueue('setDay', { date: d.date, budget: b }); }
    }
    persist();
  }
  function dayTotals(date) {
    const { logByDate, exByDate, dayByDate } = I();
    const log = logByDate.get(date) || [], ex = exByDate.get(date) || [];
    const eaten = log.reduce((a, l) => a + (l.cal || 0), 0);
    const burned = ex.reduce((a, x) => a + (x.cal || 0), 0);
    const budget = budgetFor(date);
    const pro = log.reduce((a, l) => a + (l.pro || 0), 0), fib = log.reduce((a, l) => a + (l.fib || 0), 0);
    const day = dayByDate.get(date) || {};
    return { log, ex, eaten, burned, budget, left: budget + burned - eaten, pro, fib, done: !!day.done, water: day.water || 0 };
  }
  function defaultSlot() {
    const h = new Date().getHours() + new Date().getMinutes() / 60, v = visibleSlots();
    let s = h < 6.5 ? 'Early Snacks' : h < 10.75 ? 'Breakfast' : h < 15.5 ? 'Lunch' : h < 20.5 ? 'Dinner' : 'Snacks';
    if (!v.includes(s)) s = v.includes('Breakfast') && h < 10.75 ? 'Breakfast' : v[v.length - 1];
    return s;
  }

  // Smart suggestions: how often a food is eaten in this slot, weekday vs weekend, near this hour, recently.
  function suggestions(slot, date) {
    const t = today(), wk = isWeekend(date), hr = new Date().getHours();
    const score = new Map(), lastQty = new Map();
    for (const l of state.data.log) {
      if (!l.food) continue;
      const age = Math.max(0, daysBetween(l.date, t));
      let w = Math.exp(-age / 90) * (l.meal === slot ? 3 : 0.25) * (isWeekend(l.date) === wk ? 1.5 : 1);
      if (l.time) { const lh = Number(l.time.slice(0, 2)); if (Math.abs(lh - hr) <= 2) w *= 1.4; }
      score.set(l.food, (score.get(l.food) || 0) + w);
      const prev = lastQty.get(l.food);
      if (!prev || prev.date <= l.date) lastQty.set(l.food, { date: l.date, qty: l.qty, unit: l.unit });
    }
    return { score, lastQty };
  }
  function pastMeals(slot, date) {
    const t = today(), wk = isWeekend(date), groups = new Map();
    for (const l of state.data.log) {
      if (daysBetween(l.date, t) > 120) continue;
      const k = l.date + '|' + l.meal;
      if (!groups.has(k)) groups.set(k, { date: l.date, meal: l.meal, items: [] });
      groups.get(k).items.push(l);
    }
    const seen = new Map();
    for (const g of groups.values()) {
      if (g.items.length < 2) continue;
      const sig = g.items.map(i => i.food || i.name).sort().join('+');
      const w = Math.exp(-daysBetween(g.date, t) / 45) * (g.meal === slot ? 3 : 0.3) * (isWeekend(g.date) === wk ? 1.5 : 1);
      const cur = seen.get(sig);
      if (!cur) seen.set(sig, { ...g, score: w, count: 1 });
      else { cur.score += w; cur.count++; if (g.date > cur.date) { cur.date = g.date; cur.items = g.items; cur.meal = g.meal; } }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 30);
  }

  // ---------- gamification ----------
  function loggedDates() { return new Set([...I().logByDate.keys()]); }
  function streak() {
    const s = loggedDates(); let d = today(); if (!s.has(d)) d = addDays(d, -1);
    let n = 0; while (s.has(d)) { n++; d = addDays(d, -1); } return n;
  }
  function bestStreak() {
    const ds = [...loggedDates()].sort(); let best = 0, cur = 0, prev = null;
    for (const d of ds) { cur = prev && addDays(prev, 1) === d ? cur + 1 : 1; best = Math.max(best, cur); prev = d; }
    return best;
  }
  function appStart() {
    let s = load('appStart', null);
    if (!s) { s = today(); save('appStart', s); }
    return s;
  }
  function rewards() {
    const start = appStart(), t = today();
    let xp = 0, under = 0, done = 0, logged = 0;
    for (let d = start; d <= t; d = addDays(d, 1)) {
      const x = dayTotals(d); if (!x.log.length) continue;
      logged++; xp += 10;
      if (x.done) { done++; xp += 10; }
      if (x.done && x.left >= 0) { under++; xp += 15; }
    }
    const st = streak(), best = bestStreak();
    xp += Math.floor(Math.min(st, daysBetween(start, t) + 1) / 7) * 25;
    let level = 1; while (xp >= 25 * level * (level + 1)) level++;
    const lo = 25 * (level - 1) * level, hi = 25 * level * (level + 1);
    const badges = [
      ['🔥', '7-day streak', best >= 7], ['🔥', '30-day streak', best >= 30], ['🏅', '100-day streak', best >= 100],
      ['🏆', '365-day streak', best >= 365], ['✅', 'First done day', done >= 1], ['📘', '10 done days', done >= 10],
      ['🎯', 'Under budget ×5', under >= 5], ['🎯', 'Under budget ×25', under >= 25], ['🥗', '50 days logged', logged >= 50],
      ['⭐', 'Level 5', level >= 5], ['🌟', 'Level 10', level >= 10], ['💧', 'Water tracked', waterOn()]
    ];
    return { xp, level, pct: Math.round((xp - lo) / (hi - lo) * 100), toNext: hi - xp, st, best, badges };
  }

  // ---------- rendering ----------
  function render() {
    if (!state.data) { $('#app').innerHTML = `<div class="wrap" style="padding-top:40px"><div class="card">${state.error ? 'Couldn’t load: ' + esc(state.error) + (state.error === 'unauthorized' ? '<div class="field" style="margin-top:12px"><label>Access key</label><input id="keyin" autocomplete="off" autocapitalize="off"></div><button class="btn big" id="keysave">Save key</button>' : '<br><br><button class="btn" onclick="location.reload()">Try again</button>') : 'Loading your log…'}</div></div>`; const ks = $('#keysave'); if (ks) ks.onclick = () => { save('key', ($('#keyin').value || '').trim()); location.reload(); };
      return; }
    const v = state.view;
    $('#app').innerHTML = header() + `<main class="wrap">${v === 'day' ? dayView() : v === 'week' ? weekView() : settingsView()}</main>` + nav();
    renderSync(); bind();
    if (state.modal) renderModal();
  }
  function header() {
    if (state.view === 'day') return `<header class="top"><div class="top-row">
      <button class="icon-btn" data-act="prev">‹</button><h1>${esc(dayLabel(state.date))}</h1>
      <button class="icon-btn" data-act="next">›</button></div>
      <div class="top-row" style="justify-content:center;margin-top:6px;gap:6px"><span class="chip">🔥 ${streak()} days</span><span class="chip">⭐ Lv ${rewards().level}</span></div>
      <div class="sync" id="sync"></div></header>`;
    if (state.view === 'week') return `<header class="top"><div class="top-row">
      <button class="icon-btn" data-act="wprev">‹</button><h1>Week of ${esc(parse(weekStart(state.weekOf)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</h1>
      <button class="icon-btn" data-act="wnext">›</button></div><div class="sync" id="sync"></div></header>`;
    return `<header class="top"><div class="top-row"><h1>${esc(PERSON)}’s plan</h1></div><div class="sync" id="sync"></div></header>`;
  }
  function renderSync() {
    const el = $('#sync'); if (!el) return;
    const n = state.queue.length;
    el.className = 'sync' + (state.error ? ' warn' : '');
    el.textContent = state.error ? `Not synced${n ? ` (${n} waiting)` : ''}: ${state.error}` : state.syncing ? 'Saving…' : n ? `${n} waiting to save` : '';
  }
  function nav() {
    const b = (v, i, t) => `<button class="${state.view === v ? 'on' : ''}" data-view="${v}"><span class="i">${i}</span>${t}</button>`;
    return `<nav class="tabs">${b('day', '📅', 'Day')}${b('week', '📊', 'Week')}<button class="plus" data-act="add">+</button>${b('settings', '🎯', 'Plan')}<button data-act="refresh"><span class="i">⟳</span>Sync</button></nav>`;
  }

  function dayView() {
    const x = dayTotals(state.date), over = x.left < 0;
    const cap = x.budget + x.burned, pct = cap > 0 ? Math.min(100, x.eaten / cap * 100) : 0;
    const markPct = cap > 0 ? Math.min(100, x.budget / cap * 100) : 0;
    let h = `<section class="card"><div class="summary">
      <div><b>${fmt(x.budget)}</b><span>Budget</span></div><div><b>${fmt(x.eaten)}</b><span>Food</span></div>
      <div><b>${fmt(x.burned)}</b><span>Exercise</span></div><div class="left ${over ? 'over' : ''}"><b>${fmt(Math.abs(x.left))}</b><span>${over ? 'Over' : 'Left'}</span></div></div>
      <div class="bar"><div class="fill ${over ? 'over' : ''}" style="width:${pct}%"></div>${x.burned ? `<div class="mark" style="left:${markPct}%"></div>` : ''}</div>
      <div class="macros"><span>Protein ${r0(x.pro)} g</span><span>Fiber ${r0(x.fib)} g</span>${x.log.some(isPlanned) ? `<span>🕒 ${fmt(x.log.filter(isPlanned).reduce((a, l) => a + l.cal, 0))} planned</span>` : ''}</div></section>`;
    for (const slot of visibleSlots()) {
      const items = x.log.filter(l => l.meal === slot);
      const tot = items.reduce((a, l) => a + (l.cal || 0), 0);
      h += `<section class="card"><h2>${slot}<small>${items.length ? fmt(tot) + ' cal' : ''}</small></h2>
        ${items.map(l => `<div class="entry ${isPlanned(l) ? 'planned' : ''}" role="button" data-entry="${esc(l.id || '')}" data-ekey="${esc(entryKey(l))}">
          <div class="nm"><div>${isPlanned(l) ? '🕒 ' : ''}${esc(l.name)}${l.est ? '<span class="est">EST</span>' : ''}</div><small>${esc(qtyText(l))}${isPlanned(l) ? ' · planned' : ''}</small></div><div class="cal">${fmt(l.cal)}</div>
          ${isPlanned(l) && state.date <= today() ? `<button class="ate-btn" data-ate="${esc(entryKey(l))}" aria-label="Ate it">✓</button>` : ''}</div>`).join('')}
        ${state.date <= today() && items.filter(isPlanned).length > 1 ? `<button class="add-line" data-confirm="${slot}">✓ Ate all ${items.filter(isPlanned).length} planned items</button>` : ''}
        <button class="add-line" data-addslot="${slot}">+ Add food</button></section>`;
    }
    // hidden-slot entries (e.g. old Early Snacks) still show so totals make sense
    const hidden = x.log.filter(l => !visibleSlots().includes(l.meal));
    if (hidden.length) h += `<section class="card"><h2>Other<small>${fmt(hidden.reduce((a, l) => a + l.cal, 0))} cal</small></h2>${hidden.map(l => `<div class="entry"><div class="nm"><div>${esc(l.name)}</div><small>${esc(l.meal)}</small></div><div class="cal">${fmt(l.cal)}</div></div>`).join('')}</section>`;
    h += `<section class="card"><h2>Exercise<small>${x.burned ? fmt(x.burned) + ' cal' : ''}</small></h2>
      ${x.ex.map(e => `<button class="entry" style="width:100%;text-align:left" data-ex="${esc(e.id || '')}"><div class="nm"><div>${esc(e.name)}</div><small>${e.min ? r0(e.min) + ' min' : ''} ${esc(e.source || '')}</small></div><div class="cal">${fmt(e.cal)}</div></button>`).join('') || '<div class="empty">No exercise yet</div>'}
      <button class="add-line" data-act="addex">+ Add exercise</button></section>`;
    if (waterOn()) h += `<section class="card"><h2>Water</h2><div class="water"><div class="cups">💧 ${r0(x.water)} fl oz</div>
      <button class="btn ghost" data-water="-8">−8</button><button class="btn" data-water="8">+8 oz</button></div></section>`;
    h += x.done
      ? `<button class="btn big ghost" data-act="undone">✓ Done for the day · tap to reopen</button>`
      : `<button class="btn big done" data-act="done">I'm done logging today</button>`;
    h += `<div class="tell"><button data-tell="Dietitian">💬 Tell my dietitian</button><button data-tell="Developer">🛠 Tell my developer</button></div>`;
    return h;
  }
  const entryKey = l => l.id || `${l.date}|${l.meal}|${l.name}|${l.qty}`;
  const qtyText = l => `${+Number(l.qty || 0).toFixed(2)} ${l.unit || ''}`.trim();

  const weekStart = s => { const d = parse(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return ymd(d); };
  // Average daily food over the last 28 logged days before today (for unplanned days in the projection)
  function recentAvg() {
    const t = today(); let sum = 0, n = 0;
    for (let i = 1; i <= 60 && n < 28; i++) {
      const d = addDays(t, -i), x = dayTotals(d);
      if (x.log.length) { sum += x.eaten; n++; }
    }
    return n ? sum / n : budgetFor(t);
  }
  function weekView() {
    const ws = weekStart(state.weekOf), t = today(), avg = recentAvg();
    let tot = 0, proj = 0, assumed = [], anyPast = false, rows = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), x = dayTotals(d), cap = x.budget + x.burned;
      const has = x.log.length > 0, future = d > t, isToday = d === t;
      let val = null, kind = '';
      if (!future && has) { tot += x.left; anyPast = true; val = x.left; kind = 'actual'; }
      if (future || (isToday && !has)) {
        if (has) { val = x.left; kind = 'planned'; }
        else { val = x.budget + x.burned - avg; kind = 'assumed'; assumed.push(parse(d).toLocaleDateString(undefined, { weekday: 'short' })); }
      }
      if (val !== null) proj += val;
      const eaten = kind === 'assumed' ? avg : x.eaten;
      const w = cap > 0 ? Math.min(100, eaten / cap * 100) : 0;
      const sign = v => (v < 0 ? '+' : '−') + fmt(Math.abs(v));
      rows += `<button class="week-row ${isToday ? 'today' : ''} ${future ? 'future' : ''} ${kind === 'planned' || kind === 'assumed' ? 'proj' : ''}" style="width:100%;text-align:left" data-goto="${d}">
        <div class="d">${parse(d).toLocaleDateString(undefined, { weekday: 'short' })}<small>${kind === 'planned' ? 'planned' : kind === 'assumed' ? 'avg' : parse(d).getDate()}</small></div>
        <div class="bar" style="margin:0"><div class="fill ${val !== null && val < 0 ? 'over' : ''} ${kind === 'assumed' ? 'ghost' : ''}" style="width:${val !== null ? w : 0}%"></div></div>
        <div class="v ${val === null ? '' : val < 0 ? 'over' : 'under'}">${val !== null ? sign(val) : '—'}</div></button>`;
    }
    const weekOver = ws > t, weekPast = addDays(ws, 6) < t;
    const box = (label, v) => `<div class="sub" style="margin:0">${label}</div><div class="wk-total ${v < 0 ? 'over' : 'under'}">${fmt(Math.abs(v))} cal ${v < 0 ? 'over' : 'under'}</div>`;
    const amt = v => `${fmt(Math.abs(v))} ${v < 0 ? 'over' : 'under'}`;
    let top = '';
    if (weekPast) top = `<div class="sub" style="margin:0">Week total</div><div class="wk-total ${tot < 0 ? 'over' : 'under'}">${amt(tot)}</div>`;
    else if (weekOver) top = `<div class="sub" style="margin:0">Projected for the week</div><div class="wk-total ${proj < 0 ? 'over' : 'under'}">${amt(proj)}</div>`;
    else top = `<div class="sub" style="margin:0">This week so far</div><div class="wk-total ${tot < 0 ? 'over' : 'under'}">${amt(tot)} <span class="wk-proj ${proj < 0 ? 'over' : 'under'}">(projected ${amt(proj)})</span></div>`;
    if (!weekPast && assumed.length) top += `<div class="sub" style="margin:8px 0 0">Assuming ${fmt(avg)} cal a day (your recent average) for ${assumed.join(', ')}, with nothing planned yet</div>`;
    return `<section class="card">${top}</section>
      <section class="card">${rows}<div class="sub" style="margin:8px 0 0">Under (−) or over (+) each day. Faded rows are projected.</div></section>`;
  }
  function planCard() {
    const pl = planFor(today());
    if (!pl) return `<section class="card"><h2>My plan</h2><div class="empty">Add birthday, sex, height and a weigh-in to the Profiles and Body tabs to calculate a plan.</div></section>`;
    const goalTxt = pl.goal === 0 ? 'maintain your weight' : `${pl.goal < 0 ? 'lose' : 'gain'} ${Math.abs(pl.goal)} lb per week`;
    const ws = weekStart(today()), days = [...Array(7)].map((_, i) => addDays(ws, i));
    const tg = days.map(d => Math.round(pl.base + (isWeekend(d) ? pl.wkndExtra : pl.wkdayAdj)));
    const lo = Math.min(pl.burn, ...tg) * 0.6, mx = Math.max(pl.burn, ...tg) * 1.03, pct = v => (v - lo) / (mx - lo) * 100;
    const rows = days.map((d, i) => {
      const t = tg[i], adj = t - Math.round(pl.base);
      return `<div class="plan-row"><div class="d">${parse(d).toLocaleDateString(undefined, { weekday: 'short' })}</div>
        <div class="plan-bar"><div class="burn" style="width:${pct(pl.burn)}%"></div><div class="tgt ${t > pl.burn + 1 ? 'gain' : ''}" style="width:${pct(t)}%"></div></div>
        <div class="v">${fmt(t)}${adj ? `<small>${adj > 0 ? '+' : '−'}${fmt(Math.abs(adj))}</small>` : ''}</div></div>`;
    }).join('');
    const wk = tg.reduce((a, b) => a + b, 0);
    return `<section class="card"><h2>My plan</h2>
      <p class="plan-txt">At ${pl.age}, ${Math.floor(pl.h / 12)}′${Math.round(pl.h % 12)}″ and ${pl.wt} lb, your sedentary burn is ${pl.manual ? `${fmt(pl.sedentary)}, and with your ${pl.manual < 0 ? '−' : '+'}${fmt(Math.abs(pl.manual))} manual adjustment it’s <b>${fmt(pl.burn)}</b>` : `<b>${fmt(pl.burn)}</b>`} cal a day.
      Your plan is to <b>${goalTxt}</b>${pl.daily ? `, ${pl.daily < 0 ? 'minus' : 'plus'} ${fmt(Math.abs(pl.daily))} a day` : ''}, for a daily target of <b>${fmt(pl.base)}</b>.</p>
      ${rows}
      <div class="plan-legend"><span><i class="burn"></i>${pl.manual ? 'Adjusted burn' : 'Sedentary burn'}</span><span><i class="tgt"></i>Target</span></div>
      <div class="sub" style="margin:6px 0 0">Week total ${fmt(wk)} cal · exercise adds to each day · this week’s days already logged keep their budget</div>
      <div class="field" style="margin-top:12px"><label>Weekly goal</label><select id="goalsel">${[...new Set([...GOALS, pl.goal])].sort((a, b) => a - b).map(g => `<option value="${g}" ${g === pl.goal ? 'selected' : ''}>${g === 0 ? 'Maintain' : (g < 0 ? 'Lose ' : 'Gain ') + Math.abs(g) + ' lb a week'}</option>`).join('')}</select></div>
      <div class="field"><label>Manual adjustment to burn</label><select id="mansel">${[...new Set([-500, -400, -300, -250, -200, -150, -100, -50, 0, 50, 100, 200, 300, pl.manual])].sort((a, b) => a - b).map(v => `<option value="${v}" ${v === pl.manual ? 'selected' : ''}>${v ? (v > 0 ? '+' : '−') + Math.abs(v) + ' cal a day' : 'None'}</option>`).join('')}</select></div>
      <div class="field"><label>Weekend extra (weekdays give it back)</label><select id="wkndsel">${[0, 100, 150, 200, 250, 300, 400, 500].map(v => `<option value="${v}" ${v === pl.wkndExtra ? 'selected' : ''}>${v ? '+' + v + ' Sat & Sun, −' + Math.round(v * 2 / 5) + ' Mon–Fri' : 'Same every day'}</option>`).join('')}</select></div>
    </section>`;
  }
  // ---------- progress ----------
  const RANGES = [['7', 'Week'], ['30', 'Month'], ['90', 'Quarter'], ['ytd', 'YTD'], ['365', 'Year']];
  function progWindow() {
    const r = state.progRange || '90', off = state.progOff || 0, t = today();
    if (r === 'ytd') {
      const y = parse(t).getFullYear() + off;
      return { from: `${y}-01-01`, to: off === 0 ? t : `${y}-12-31`, label: off === 0 ? `${y} so far` : `${y}` };
    }
    const n = Number(r), to = addDays(t, off * n), from = addDays(to, -n + 1);
    const f = d => parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: n >= 365 || parse(d).getFullYear() !== parse(t).getFullYear() ? 'numeric' : undefined });
    return { from, to, label: off === 0 ? `Last ${({ 7: 'week', 30: 'month', 90: 'quarter', 365: 'year' })[n]}` : `${f(from)} – ${f(to)}` };
  }
  function progressCard() {
    const p = profile();
    const goal = Number(p['Fat mass goal (lb)']) || null;
    const gdate = String(p['Goal date'] || '').slice(0, 10) || null;
    const all = (state.data.bodyAll || state.data.body || []).filter(b => b.weight);
    const editor = `<div class="qty-row" style="margin-top:12px">
        <div class="field" style="flex:1"><label>Fat mass goal (lb)</label><input id="fgoal" type="number" inputmode="decimal" step="0.5" value="${goal ?? ''}" placeholder="e.g. 40"></div>
        <div class="field" style="flex:1"><label>Target date</label><input id="fdate" type="date" value="${gdate ?? ''}"></div></div>`;
    const seg = `<div class="seg">${RANGES.map(([k, n]) => `<button class="${(state.progRange || '90') === k ? 'on' : ''}" data-prange="${k}">${n}</button>`).join('')}</div>`;
    const win = progWindow(), t = today(), isNow = (state.progOff || 0) === 0;
    const nav = `<div class="prog-nav"><button class="icon-btn" data-poff="-1">‹</button><span>${esc(win.label)}</span><button class="icon-btn" data-poff="1" ${isNow ? 'disabled' : ''}>›</button></div>`;
    if (all.length < 3) return `<section class="card"><h2>Progress</h2>${seg}<div class="empty">Not enough weigh-ins yet.</div>${editor}</section>`;
    const fatAll = all.filter(b => b.fatLb);
    const useFat = fatAll.length >= 3;
    const series = (useFat ? fatAll : all).map(b => ({ d: b.date, v: useFat ? b.fatLb : b.weight }));
    // rolling average of the last 7 readings, over the full history so window edges are smooth
    const avgAll = series.map((x, i) => { const w = series.slice(Math.max(0, i - 6), i + 1); return { d: x.d, v: w.reduce((a, b) => a + b.v, 0) / w.length }; });
    const pts = series.filter(x => x.d >= win.from && x.d <= win.to);
    const avg = avgAll.filter(x => x.d >= win.from && x.d <= win.to);
    const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
    const label = useFat ? 'Fat mass' : 'Weight';
    const fmtD = d => parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (pts.length < 2) return `<section class="card"><h2>Progress</h2>${seg}${nav}<div class="empty">Fewer than two weigh-ins in this period.</div>${editor}</section>`;
    const cur = avgAll[avgAll.length - 1].v;
    // pace over the last 28 days (lb/week), for the goal projection
    const fit = arr => { if (arr.length < 3) return null; const xs = arr.map(r => daysBetween(arr[0].d, r.d)), ys = arr.map(r => r.v);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length, den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      return den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den * 7 : null; };
    const pace = fit(series.filter(x => daysBetween(x.d, t) <= 28));
    const weeksLeft = gdate ? Math.max(0, daysBetween(t, gdate) / 7) : null;
    const toGo = goal != null ? cur - goal : null;
    const need = goal != null && weeksLeft ? toGo / weeksLeft : null;
    let proj = null;
    if (goal != null && pace != null && pace < 0 && toGo > 0) proj = addDays(t, Math.round(toGo / -pace * 7));
    // chart: the window, plus the run to the goal date when looking at the current period
    const showGoal = goal != null && isNow;
    const W = 340, H = 170, L = 34, R = 8, T = 10, B = 22;
    const d0 = win.from, dEnd = showGoal && gdate && gdate > win.to ? gdate : win.to;
    const span = Math.max(1, daysBetween(d0, dEnd));
    const vals = pts.map(x => x.v).concat(avg.map(x => x.v)).concat(showGoal ? [goal] : []);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const X = d => L + daysBetween(d0, d) / span * (W - L - R), Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const line = a => a.map((x, i) => `${i ? 'L' : 'M'}${X(x.d).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' ');
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="prog">`;
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 4}" y="${Y(v) + 4}" text-anchor="end" class="ax">${Math.round(v)}</text>`; }
    svg += pts.map(x => `<circle cx="${X(x.d)}" cy="${Y(x.v)}" r="${pts.length > 120 ? 1.4 : 2.2}" class="raw"/>`).join('');
    svg += `<path d="${line(avg)}" class="avg"/>`;
    if (showGoal) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${Y(goal)}" y2="${Y(goal)}" class="goal"/><text x="${W - R}" y="${Y(goal) - 4}" text-anchor="end" class="ax goalt">goal ${goal}</text>`;
      if (gdate && gdate > t) svg += `<path d="M${X(t)},${Y(cur)} L${X(gdate)},${Y(goal)}" class="need"/>`;
      if (pace != null) { const end = gdate && gdate > t ? gdate : addDays(t, 28); svg += `<path d="M${X(t)},${Y(cur)} L${X(end)},${Y(cur + pace * daysBetween(t, end) / 7)}" class="pace"/>`; }
    }
    svg += `<text x="${L}" y="${H - 6}" class="ax">${esc(parse(d0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">${esc(parse(dEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</text></svg>`;
    // period summary
    const a0 = avg[0].v, a1 = avg[avg.length - 1].v, wks = Math.max(1 / 7, daysBetween(avg[0].d, avg[avg.length - 1].d) / 7);
    const delta = a1 - a0;
    const wPts = all.filter(b => b.date >= win.from && b.date <= win.to);
    const wDelta = wPts.length > 1 ? wPts[wPts.length - 1].weight - wPts[0].weight : null;
    let txt = `<b>${esc(win.label)}:</b> ${label.toLowerCase()} ${delta <= 0 ? 'down' : 'up'} <b>${f1(Math.abs(delta))} lb</b> (${f1(Math.abs(delta) / wks)} lb/week)${wDelta != null && useFat ? `, weight ${wDelta <= 0 ? 'down' : 'up'} ${f1(Math.abs(wDelta))} lb` : ''}.`;
    if (isNow) {
      const status = need == null || pace == null ? '' : (-pace >= need ? '<b class="ok">on pace</b>' : '<b class="bad">behind pace</b>');
      txt += goal != null
        ? ` Now <b>${f1(cur)} lb</b>, <b>${f1(Math.max(0, toGo))} lb</b> from your ${goal} lb goal.
           ${need != null ? `By ${esc(fmtD(gdate))} you need <b>${f1(need)} lb/week</b>.` : 'Set a target date to see the pace you need.'}
           ${pace != null ? `Last 4 weeks: <b>${f1(-pace)} lb/week</b> ${pace <= 0 ? 'down' : 'up'}${proj ? `, goal around <b>${esc(fmtD(proj))}</b>` : ''}. ${status}` : ''}`
        : ` Now <b>${f1(cur)} lb</b>. Set a goal below to track pace.`;
    }
    const lastW = all[all.length - 1].weight;
    return `<section class="card"><h2>Progress<small>weight ${lastW} lb</small></h2>${seg}${nav}${svg}
      <div class="plan-legend"><span><i class="avg"></i>${label} (avg)</span>${showGoal ? '<span><i class="need"></i>Needed</span><span><i class="pace"></i>Your pace</span>' : ''}</div>
      <p class="plan-txt" style="margin-top:10px">${txt}</p>${editor}</section>`;
  }
  function settingsView() {
    const rw = rewards(), vs = visibleSlots();
    return planCard() + progressCard() + `<section class="card"><h2>Level ${rw.level}<small>${fmt(rw.xp)} XP</small></h2>
      <div class="level"><div class="ring" style="--p:${rw.pct}"><span>${rw.level}</span></div>
      <div>${fmt(rw.toNext)} XP to level ${rw.level + 1}<br><small style="color:var(--muted)">Streak ${rw.st} days · best ${rw.best}</small></div></div></section>
      <section class="card"><h2>Badges</h2><div class="badges">${rw.badges.map(([e, n, got]) => `<div class="badge ${got ? 'got' : ''}"><span class="e">${e}</span>${esc(n)}</div>`).join('')}</div>
      <div class="sub" style="margin:10px 0 0">XP: 10 per day logged, +10 for done, +15 for done under budget, +25 per week of streak</div></section>
      <section class="card"><h2>Meal sections</h2>${ALL_SLOTS.map(s => `<div class="toggle-row"><span>${s}</span><button class="switch ${vs.includes(s) ? 'on' : ''}" data-slot="${s}"></button></div>`).join('')}</section>
      <section class="card"><h2>Extras</h2><div class="toggle-row"><span>Track water</span><button class="switch ${waterOn() ? 'on' : ''}" data-act="water"></button></div></section>
      <section class="card"><div class="sub" style="margin:0">App version ${esc(load('version', '?'))} · Data: Food_Log sheet · ${state.data.foods.length.toLocaleString()} foods · last sync ${esc(new Date(state.data.serverTime || Date.now()).toLocaleString())}</div></section>`;
  }

  // ---------- modals ----------
  function openModal(m) { state.modal = m; renderModal(); }
  function closeModal() { stopScan(); state.modal = null; const o = $('#overlay'); if (o) o.remove(); }
  function renderModal() {
    let o = $('#overlay');
    if (!o) { o = document.createElement('div'); o.id = 'overlay'; o.className = 'overlay'; document.body.appendChild(o);
      o.addEventListener('click', e => { if (e.target === o) closeModal(); }); }
    const m = state.modal;
    const body = m.type === 'add' ? addSheet(m) : m.type === 'food' ? foodSheet(m) : m.type === 'entry' ? entrySheet(m)
      : m.type === 'quick' ? quickSheet(m) : m.type === 'ex' ? exSheet(m) : m.type === 'meal' ? mealSheet(m) : m.type === 'tell' ? tellSheet(m) : m.type === 'scan' ? scanSheet(m) : '';
    const keepSearch = $('#q') && document.activeElement === $('#q');
    const pos = keepSearch ? $('#q').selectionStart : null;
    o.innerHTML = `<div class="sheet">${body}</div>`;
    bindModal();
    if (keepSearch && $('#q')) { $('#q').focus(); try { $('#q').setSelectionRange(pos, pos); } catch (e) {} }
  }
  const head = (title, back) => `<div class="sheet-head">${back ? '<button class="icon-btn" data-m="back">‹</button>' : ''}<h3>${esc(title)}</h3><button class="icon-btn" data-m="close">✕</button></div>`;

  function addSheet(m) {
    const slots = visibleSlots();
    const pick = `<div class="meal-pick">${slots.map(s => `<button class="${s === m.slot ? 'on' : ''}" data-mslot="${s}">${s}</button>`).join('')}</div>`;
    const seg = `<div class="seg">${[['foods', 'My foods'], ['meals', 'Meals'], ['quick', 'Quick entry']].map(([k, t]) => `<button class="${m.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>`;
    let list = '';
    if (m.tab === 'foods') {
      const { score, lastQty } = suggestions(m.slot, state.date);
      const q = (m.q || '').trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
      let foods = state.data.foods;
      if (toks.length) foods = foods.filter(f => { const n = (f.name + ' ' + (f.brand || '')).toLowerCase(); return toks.every(t => n.includes(t)); });
      else foods = foods.filter(f => score.has(f.id));
      foods = foods.map(f => [f, score.get(f.id) || 0]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).slice(0, 60);
      list = `<div class="qty-row"><input id="q" class="search" placeholder="Search your foods" value="${esc(m.q || '')}" autocomplete="off"><button class="btn ghost" style="margin-bottom:8px" data-m="scan">📷 Scan</button></div>
        ${!toks.length ? `<div class="sub" style="text-align:left;margin:4px 0">Suggested for ${esc(m.slot)} · ${isWeekend(state.date) ? 'weekend' : 'weekday'}</div>` : ''}
        ${foods.map(([f]) => { const lq = lastQty.get(f.id); const qty = lq ? lq.qty : f.per;
          return `<button class="pick" data-food="${esc(f.id)}"><div class="nm"><div>${esc(f.name)}${f.est ? '<span class="est">EST</span>' : ''}</div>
          <small>${esc(f.brand ? f.brand + ' · ' : '')}${+Number(qty).toFixed(2)} ${esc(f.unit)}</small></div><div class="cal">${fmt(f.cal / f.per * qty)}</div></button>`; }).join('')
        || `<div class="empty">No match. Try Quick entry and Claude will look it up.</div>`}`;
    } else if (m.tab === 'meals') {
      const meals = pastMeals(m.slot, state.date);
      list = meals.map((g, i) => `<button class="pick" data-meal="${i}"><div class="nm"><div>${esc(g.items.map(x => x.name).join(', '))}</div>
        <small>${esc(g.meal)} · ${esc(dayLabel(g.date))}${g.count > 1 ? ` · had ${g.count}×` : ''}</small></div><div class="cal">${fmt(g.items.reduce((a, x) => a + x.cal, 0))}</div></button>`).join('')
        || '<div class="empty">No past meals yet.</div>';
      m._meals = meals;
    } else {
      return head('Add to ' + dayLabel(state.date)) + `<div class="sheet-body">${pick}${seg}${quickForm(m)}</div>`;
    }
    return head('Add to ' + dayLabel(state.date)) + `<div class="sheet-body">${pick}${seg}${list}</div>`;
  }
  function quickForm(m) {
    return `<div class="field"><label>What did you eat?</label><input id="qname" placeholder="e.g. chicken burrito, Mexican place" value="${esc(m.qname || '')}"></div>
      <div class="field"><label>Rough calories (optional)</label><input id="qcal" type="number" inputmode="numeric" placeholder="Leave blank and Claude will estimate"></div>
      <button class="btn big" data-m="quicksave">Add as estimate</button>
      <div class="sub" style="margin-top:10px">Claude finds the restaurant's posted numbers (or similar items) and fixes the entry.</div>`;
  }
  // ---------- unit families (convertible units, like Lose It!) ----------
  const FAMILIES = {
    weight: { Gram: 1, Ounce: 28.3495, Pound: 453.592, Kilogram: 1000 },
    volume: { Teaspoon: 4.929, Tablespoon: 14.787, 'Fluid Ounce': 29.574, Cup: 236.59, Milliliter: 1, Liter: 1000 }
  };
  const UNIT_ALIAS = { gram: 'Gram', grams: 'Gram', g: 'Gram', ounce: 'Ounce', ounces: 'Ounce', oz: 'Ounce', pound: 'Pound', pounds: 'Pound', lb: 'Pound',
    kilogram: 'Kilogram', kg: 'Kilogram', teaspoon: 'Teaspoon', teaspoons: 'Teaspoon', tsp: 'Teaspoon', tablespoon: 'Tablespoon', tablespoons: 'Tablespoon', tbsp: 'Tablespoon',
    'fluid ounce': 'Fluid Ounce', 'fluid ounces': 'Fluid Ounce', 'fl oz': 'Fluid Ounce', cup: 'Cup', cups: 'Cup', milliliter: 'Milliliter', ml: 'Milliliter', liter: 'Liter', l: 'Liter' };
  const canonUnit = u => UNIT_ALIAS[String(u || '').toLowerCase().trim()] || u;
  function familyOf(u) { const c = canonUnit(u); for (const [k, m] of Object.entries(FAMILIES)) if (m[c]) return { name: k, map: m, unit: c }; return null; }
  // amount in `unit` expressed in the food's own unit (null if they can't convert)
  function toFoodUnits(f, qty, unit) {
    if (!unit || canonUnit(unit) === canonUnit(f.unit)) return Number(qty) || 0;
    const a = familyOf(unit), b = familyOf(f.unit);
    if (!a || !b || a.name !== b.name) return Number(qty) || 0;
    return (Number(qty) || 0) * a.map[a.unit] / b.map[b.unit];
  }
  function nutrFor(f, qty, unit) {
    const k = toFoodUnits(f, qty, unit) / f.per, n = v => v == null ? null : v * k;
    return { cal: f.cal * k, pro: n(f.pro), fib: n(f.fib), carb: n(f.carb), fat: n(f.fat) };
  }
  const FRACTIONS = [['¼', .25], ['⅓', 1 / 3], ['½', .5], ['⅔', 2 / 3], ['¾', .75]];
  function amountControls(f, qty, unit, idQ, idU) {
    const fam = familyOf(f.unit);
    const sel = fam ? `<select id="${idU}" class="unit-sel">${Object.keys(fam.map).map(u => `<option ${u === canonUnit(unit || f.unit) ? 'selected' : ''}>${u}</option>`).join('')}</select>` : `<span class="unit-fixed">${esc(f.unit)}</span>`;
    const fr = fam ? '' : `<div class="fracs">${FRACTIONS.map(([t, v]) => `<button class="btn ghost" data-frac="${v}">${t}</button>`).join('')}</div>`;
    return `<div class="field"><label>Amount</label><div class="stepper"><button class="btn ghost" data-step="-1">−</button><input id="${idQ}" type="number" inputmode="decimal" step="any" value="${esc(+Number(qty).toFixed(2))}"><button class="btn ghost" data-step="1">+</button></div>
      <div class="unit-row">${sel}</div>${fr}</div>`;
  }

  // ---------- unit insight ----------
  const WEIGHT_G = { gram: 1, grams: 1, g: 1, ounce: 28.35, ounces: 28.35, oz: 28.35, pound: 453.6, pounds: 453.6, lb: 453.6, kilogram: 1000, kg: 1000 };
  const normName = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // grams in one unit of a food: a weight unit converts directly; otherwise match a gram-based entry of the same food by calories
  function gramsPerUnit(f) {
    if (!f) return null;
    const w = WEIGHT_G[String(f.unit || '').toLowerCase()];
    if (w) return w;
    if (!(f.cal > 0)) return null;
    const key = normName(f.name);
    const g = state.data.foods.find(x => x !== f && normName(x.name) === key && WEIGHT_G[String(x.unit || '').toLowerCase()] && x.cal > 0);
    if (!g) return null;
    const calPerGram = g.cal / g.per / WEIGHT_G[String(g.unit).toLowerCase()];
    return (f.cal / f.per) / calPerGram;
  }
  function unitInfo(f) {
    if (!f) return '';
    const gpu = gramsPerUnit(f), isG = String(f.unit).toLowerCase().startsWith('gram');
    // per 100 g for gram foods, per 1 unit otherwise
    const n = isG ? 100 : 1, k = n / f.per;
    const head = isG ? 'Per 100 g' : `Per 1 ${esc(f.unit)}${gpu ? ` (≈ ${gpu >= 10 ? r0(gpu) : Math.round(gpu * 10) / 10} g)` : ''}`;
    const m = (v, lab) => v == null ? '' : ` · ${lab} ${Math.round(v * k * 10) / 10} g`;
    const line2 = gpu && !isG ? `<br>${(Math.round(f.cal / f.per / gpu * 100) / 100).toFixed(2)} cal per gram` : '';
    return `<div class="unit-info"><b>${head}:</b> ${fmt(f.cal * k)} cal${m(f.pro, 'protein')}${m(f.fib, 'fiber')}${m(f.carb, 'carbs')}${m(f.fat, 'fat')}${line2}${f.brand ? `<br>${esc(f.brand)}` : ''}</div>`;
  }
  const macroText = l => ['pro', 'fib', 'carb', 'fat'].some(k => l[k] != null)
    ? `Protein ${r0(l.pro || 0)} g · Fiber ${r0(l.fib || 0)} g · Carbs ${r0(l.carb || 0)} g · Fat ${r0(l.fat || 0)} g` : '';
  function gramsField(f, qty, id) {
    const gpu = gramsPerUnit(f);
    if (!gpu || familyOf(f.unit)) return '';
    return `<div class="field"><label>Or enter grams</label><input id="${id}" type="number" inputmode="decimal" step="any" value="${r0((Number(qty) || 0) * gpu)}" data-gpu="${gpu}"></div>`;
  }

  function foodSheet(m) {
    const f = I().foodById.get(m.food); if (!f) return head('Food', true) + '<div class="sheet-body"><div class="empty">Food not found.</div></div>'; const qty = m.qty;
    const k = (Number(qty) || 0) / f.per;
    return head(f.name, true) + `<div class="sheet-body">
      <div class="big-cal" id="fcal">${fmt(f.cal * k)}</div><div class="sub">calories · ${esc(m.slot)}</div>
      ${unitInfo(f)}
      ${amountControls(f, qty, m.unit, 'fqty', 'funit')}
      ${gramsField(f, qty, 'fgram')}
      <div class="sub" id="fmac">Protein ${r0((f.pro || 0) * k)} g · Fiber ${r0((f.fib || 0) * k)} g · Carbs ${r0((f.carb || 0) * k)} g · Fat ${r0((f.fat || 0) * k)} g</div>
      <button class="btn big" data-m="foodsave">Add</button></div>`;
  }
  function entrySheet(m) {
    const l = m.entry, f = l.food && I().foodById.get(l.food);
    const editable = !!l.id;
    return head(l.name) + `<div class="sheet-body"><div class="big-cal" id="ecal">${fmt(l.cal)}</div><div class="sub">${esc(l.meal)} · ${esc(qtyText(l))}${l.est ? ' · estimate' : ''}</div>
      ${unitInfo(f)}
      ${editable ? `${f ? amountControls(f, l.qty, l.unit, 'eqty', 'eunit') : `<div class="field"><label>Amount (${esc(l.unit || '')})</label><div class="stepper"><button class="btn ghost" data-step="-1">−</button><input id="eqty" type="number" inputmode="decimal" step="any" value="${esc(+Number(l.qty).toFixed(2))}"><button class="btn ghost" data-step="1">+</button></div></div>`}
        ${f ? gramsField(f, l.qty, 'egram') : ''}
        <div class="sub" id="emac">${macroText(l)}</div>
        ${!f ? `<div class="field"><label>Calories</label><input id="ecalin" type="number" inputmode="numeric" value="${r0(l.cal)}"></div>` : ''}
        <div class="field"><label>Meal</label><select id="emeal">${ALL_SLOTS.map(s => `<option ${s === l.meal ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${isPlanned(l) ? '<button class="btn big done" data-m="entryate" style="margin-bottom:10px">✓ I ate this</button>'
          : '<button class="btn big ghost" data-m="entryplan" style="margin-bottom:10px">🕒 Move back to planned</button>'}
        <button class="btn big" data-m="entrysave">Save</button><button class="danger" data-m="entrydel">Delete entry</button>`
      : `<div class="sub">Older Lose It! entry (before Sep 21). Edit it in the sheet.</div>`}</div>`;
  }
  function quickSheet(m) { return head('Quick entry') + `<div class="sheet-body">${quickForm(m)}</div>`; }
  function exSheet(m) {
    if (m.entry) return head(m.entry.name) + `<div class="sheet-body"><div class="big-cal">${fmt(m.entry.cal)}</div><div class="sub">calories burned</div>
      ${m.entry.id ? `<div class="qty-row"><div class="field" style="flex:1"><label>Minutes</label><input id="xmin" type="number" inputmode="numeric" value="${esc(m.entry.min ?? '')}"></div>
        <div class="field" style="flex:1"><label>Calories</label><input id="xcal" type="number" inputmode="numeric" value="${esc(r0(m.entry.cal))}"></div></div>
        <button class="btn big" data-m="exupd">Save</button><button class="danger" data-m="exdel">Delete exercise</button>` : '<div class="sub">Older imported entry. Edit it in the sheet.</div>'}</div>`;
    const recent = [...new Set(state.data.exercise.slice(-200).map(x => x.name))].slice(-8).reverse();
    return head('Add exercise') + `<div class="sheet-body">
      <div class="field"><label>Activity</label><input id="xname" list="xlist" placeholder="Bicycling"><datalist id="xlist">${recent.map(n => `<option>${esc(n)}</option>`).join('')}</datalist></div>
      <div class="qty-row"><div class="field" style="flex:1"><label>Minutes</label><input id="xmin" type="number" inputmode="numeric"></div>
      <div class="field" style="flex:1"><label>Calories</label><input id="xcal" type="number" inputmode="numeric"></div></div>
      <button class="btn big" data-m="exsave">Add</button></div>`;
  }
  function mealSheet(m) {
    const g = m.group;
    return head('Add meal', true) + `<div class="sheet-body">
      ${g.items.map(x => `<div class="entry"><div class="nm"><div>${esc(x.name)}</div><small>${esc(qtyText(x))}</small></div><div class="cal">${fmt(x.cal)}</div></div>`).join('')}
      <div class="big-cal">${fmt(g.items.reduce((a, x) => a + x.cal, 0))}</div><div class="sub">to ${esc(m.slot)} · ${esc(dayLabel(state.date))}</div>
      <button class="btn big" data-m="mealsave">Add all</button></div>`;
  }

  function tellSheet(m) {
    const hint = m.to === 'Dietitian' ? 'How you’re feeling, what’s working, what to change in the plan.' : 'A bug, an idea, or something that’s awkward to use.';
    return head('Tell my ' + m.to.toLowerCase()) + `<div class="sheet-body">
      <div class="sub" style="text-align:left">${hint} Tap the mic on the keyboard to dictate.</div>
      <textarea id="tellmsg" class="search" rows="5" style="resize:vertical"></textarea>
      <button class="btn big" data-m="tellsave">Send</button></div>`;
  }

  // ---------- barcode ----------
  function scanSheet(m) {
    return head('Scan a barcode', true) + `<div class="sheet-body">
      <video id="scanvid" playsinline muted style="width:100%;border-radius:14px;background:#000;max-height:46vh;object-fit:cover"></video>
      <div class="sub" id="scanmsg" style="margin-top:8px">${esc(m.msg || 'Point the camera at the barcode')}</div>
      <div class="field"><label>Or type the barcode</label><div class="qty-row"><input id="bcin" inputmode="numeric" autocomplete="off"><button class="btn" data-m="bcgo">Look up</button></div></div></div>`;
  }
  let scanCtl = null;
  function stopScan() { try { scanCtl && scanCtl.stop(); } catch (e) {} scanCtl = null; }
  function loadZxing() {
    if (window.ZXingBrowser) return Promise.resolve();
    return new Promise((ok, bad) => { const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
  }
  async function startScan() {
    const msg = t => { const e = $('#scanmsg'); if (e) e.textContent = t; };
    try {
      await loadZxing();
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      scanCtl = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, $('#scanvid'), (res) => {
        if (res && state.modal && state.modal.type === 'scan') { stopScan(); lookupBarcode(res.getText()); }
      });
    } catch (e) { msg('Camera unavailable. Type the barcode below.'); }
  }
  async function lookupBarcode(code) {
    code = String(code || '').replace(/\D/g, ''); if (!code) return toast('Enter a barcode');
    const m = state.modal, slot = (m.back && m.back.slot) || defaultSlot();
    const known = state.data.foods.find(f => String(f.barcode || '') === code);
    const open = f => { stopScan(); state.modal = { type: 'food', food: f.id, qty: f.defQty || f.per, slot, back: m.back }; renderModal(); };
    if (known) return open(known);
    const e = $('#scanmsg'); if (e) e.textContent = 'Looking up ' + code + '…';
    try {
      const j = await (await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity,serving_size`)).json();
      const p = j.product, n = p && p.nutriments;
      if (!p || !n || n['energy-kcal_100g'] == null) { if (e) e.textContent = 'Not found. Use Quick entry and Claude will look it up.'; return; }
      const per = v => v == null ? null : Math.round(v / 100 * 1000) / 1000;
      const f = { id: uid('tmp'), tempId: '', name: p.product_name || ('Barcode ' + code), brand: (p.brands || '').split(',')[0].trim(), unit: 'Gram', per: 1,
        cal: per(n['energy-kcal_100g']), pro: per(n.proteins_100g), fib: per(n.fiber_100g), carb: per(n.carbohydrates_100g), fat: per(n.fat_100g),
        barcode: code, source: 'Open Food Facts', est: false };
      f.tempId = f.id; f.defQty = Number(p.serving_quantity) || 100;
      state.data.foods.push(f); persist();
      enqueue('addFood', { food: { ...f } });
      open(f);
    } catch (err) { if (e) e.textContent = 'Lookup failed. Check the connection or type it again.'; }
  }

  // ---------- actions ----------
  function addEntries(entries) {
    entries.forEach(e => { e.id = uid('L'); e.date = state.date; e.time = state.date === today() ? nowHM() : ''; state.data.log.push(e); });
    ensureLocalDay(state.date);
    persist();
    enqueue('addLog', { entries: entries.map(e => ({ ...e })), budget: budgetFor(state.date) });
    if (state.date > today()) entries.forEach(e => markPlanned(e, true));
    render();
    const x = dayTotals(state.date);
    toast(`Added · ${fmt(Math.abs(x.left))} ${x.left < 0 ? 'over' : 'left'}`);
  }
  function ensureLocalDay(date) {
    if (!I().dayByDate.has(date)) { state.data.days.push({ date, budget: budgetFor(date), done: false, water: 0 }); idx = null; }
  }
  function entryFromFood(f, qty, slot, unit) {
    const n = nutrFor(f, qty, unit), rnd = v => v == null ? null : Math.round(v * 10) / 10;
    return { food: f.id, meal: slot, name: f.name, qty: Number(qty), unit: unit || f.unit, cal: rnd(n.cal),
      pro: rnd(n.pro), fib: rnd(n.fib), carb: rnd(n.carb), fat: rnd(n.fat), est: !!f.est };
  }
  function setDayFlag(fields) {
    ensureLocalDay(state.date);
    Object.assign(I().dayByDate.get(state.date), fields);
    persist(); enqueue('setDay', { date: state.date, budget: budgetFor(state.date), ...fields }); render();
  }
  let toastT;
  function toast(msg, action, fn) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.innerHTML = esc(msg) + (action ? ` <button class="toast-btn">${esc(action)}</button>` : '');
    if (action) t.querySelector('.toast-btn').onclick = () => { t.style.display = 'none'; fn(); };
    t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, action ? 6000 : 2200);
  }

  function bind() {
    document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; if (state.view === 'week') state.weekOf = state.date; render(); scrollTo(0, 0); });
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
    document.querySelectorAll('[data-addslot]').forEach(b => b.onclick = () => openModal({ type: 'add', slot: b.dataset.addslot, tab: 'foods' }));
    document.querySelectorAll('[data-entry]').forEach(b => b.onclick = () => {
      const l = (I().logByDate.get(state.date) || []).find(x => entryKey(x) === b.dataset.ekey); if (l) openModal({ type: 'entry', entry: l });
    });
    document.querySelectorAll('[data-ex]').forEach((b, i) => b.onclick = () => openModal({ type: 'ex', entry: (I().exByDate.get(state.date) || [])[i] }));
    document.querySelectorAll('[data-water]').forEach(b => b.onclick = () => setDayFlag({ water: Math.max(0, dayTotals(state.date).water + Number(b.dataset.water)) }));
    const gs = $('#goalsel'); if (gs) gs.onchange = () => savePlan({ 'Weekly goal (lb/week)': Number(gs.value) });
    document.querySelectorAll('[data-prange]').forEach(b => b.onclick = () => { state.progRange = b.dataset.prange; state.progOff = 0; render(); });
    document.querySelectorAll('[data-poff]').forEach(b => b.onclick = () => { state.progOff = Math.min(0, (state.progOff || 0) + Number(b.dataset.poff)); render(); });
    const fg = $('#fgoal'); if (fg) fg.onchange = () => savePlan({ 'Fat mass goal (lb)': fg.value === '' ? '' : Number(fg.value) });
    const fd = $('#fdate'); if (fd) fd.onchange = () => savePlan({ 'Goal date': fd.value });
    const ms = $('#mansel'); if (ms) ms.onchange = () => savePlan({ 'Manual adjustment (cal)': Number(ms.value) });
    const wk = $('#wkndsel'); if (wk) wk.onchange = () => { const v = Number(wk.value); savePlan({ 'Weekend adjustment (cal)': v, 'Weekday adjustment (cal)': -Math.round(v * 2 / 5) }); };
    document.querySelectorAll('[data-ate]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const l = (I().logByDate.get(state.date) || []).find(x => entryKey(x) === b.dataset.ate); if (!l) return;
      markPlanned(l, false); render(); toast(`${l.name} confirmed`, 'Undo', () => { markPlanned(l, true); render(); });
    });
    document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => {
      const es = (I().logByDate.get(state.date) || []).filter(l => l.meal === b.dataset.confirm && isPlanned(l));
      es.forEach(l => markPlanned(l, false)); render();
      toast(`${es.length} item${es.length === 1 ? '' : 's'} confirmed`, 'Undo', () => { es.forEach(l => markPlanned(l, true)); render(); });
    });
    document.querySelectorAll('[data-tell]').forEach(b => b.onclick = () => openModal({ type: 'tell', to: b.dataset.tell }));
    document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { state.date = b.dataset.goto; state.view = 'day'; render(); });
    document.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => {
      const s = b.dataset.slot, cur = visibleSlots();
      const next = cur.includes(s) ? cur.filter(x => x !== s) : ALL_SLOTS.filter(x => cur.includes(x) || x === s);
      if (!next.length) return toast('Keep at least one meal section');
      state.data.profile['Meal slots'] = next.join(', '); persist();
      enqueue('saveSettings', { settings: { 'Meal slots': next.join(', ') } }); render();
    });
  }
  function markPlanned(l, v) {
    l.planned = v; persist();
    if (l.id) enqueue('update', { tab: 'Log', id: l.id, values: { Planned: v ? 'Yes' : 'No' } });
  }
  function savePlan(settings) {
    Object.assign(state.data.profile, settings); persist();
    enqueue('saveSettings', { settings }); syncBudgets(); render(); toast('Plan updated');
  }
  function act(a) {
    if (a === 'prev') state.date = addDays(state.date, -1);
    else if (a === 'next') state.date = addDays(state.date, 1);
    else if (a === 'wprev') state.weekOf = addDays(state.weekOf, -7);
    else if (a === 'wnext') state.weekOf = addDays(state.weekOf, 7);
    else if (a === 'add') return openModal({ type: 'add', slot: defaultSlot(), tab: 'foods' });
    else if (a === 'addex') return openModal({ type: 'ex' });
    else if (a === 'refresh') { toast('Syncing…'); return refresh(); }
    else if (a === 'done') {
      setDayFlag({ done: true });
      const x = dayTotals(state.date), st = streak();
      return toast(x.left >= 0 ? `Done! ${fmt(x.left)} under · 🔥 ${st} days` : `Logged and done · 🔥 ${st} days`);
    } else if (a === 'undone') return setDayFlag({ done: false });
    else if (a === 'water') {
      const v = waterOn() ? 'No' : 'Yes'; state.data.profile['Track water'] = v; persist();
      enqueue('saveSettings', { settings: { 'Track water': v } });
    }
    render();
  }
  function bindModal() {
    const m = state.modal; if (!m) return;
    document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => modalAct(b.dataset.m));
    document.querySelectorAll('[data-mslot]').forEach(b => b.onclick = () => { m.slot = b.dataset.mslot; renderModal(); });
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { m.tab = b.dataset.tab; renderModal(); });
    const q = $('#q'); if (q) q.oninput = () => { m.q = q.value; renderModal(); };
    const qn = $('#qname'); if (qn) qn.oninput = () => { m.qname = qn.value; };
    document.querySelectorAll('[data-food]').forEach(b => b.onclick = () => {
      const f = I().foodById.get(b.dataset.food); const lq = suggestions(m.slot, state.date).lastQty.get(f.id);
      state.modal = { type: 'food', food: f.id, qty: lq ? +Number(lq.qty).toFixed(2) : f.per, unit: lq && familyOf(lq.unit) ? canonUnit(lq.unit) : canonUnit(f.unit), slot: m.slot, back: m }; renderModal();
      setTimeout(() => { const i = $('#fqty'); if (i) { i.focus(); i.select(); } }, 50);
    });
    document.querySelectorAll('[data-meal]').forEach(b => b.onclick = () => {
      state.modal = { type: 'meal', group: m._meals[Number(b.dataset.meal)], slot: m.slot, back: m }; renderModal();
    });
    document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      const inp = $('#eqty') || $('#fqty'); if (!inp) return;
      const unit = ($('#eunit') || $('#funit'))?.value || (m.entry && m.entry.unit) || (m.food && I().foodById.get(m.food)?.unit) || '';
      const inc = /^(gram|milliliter)$/i.test(unit) ? 10 : (/ounce|teaspoon|tablespoon|cup|pound/i.test(unit) ? 0.5 : (/kilogram|liter/i.test(unit) ? 0.1 : 1));
      inp.value = Math.max(0, Math.round(((Number(inp.value) || 0) + inc * Number(b.dataset.step)) * 100) / 100);
      inp.dispatchEvent(new Event('input'));
    });
    const syncG = (gid, qid) => {
      const g = $('#' + gid), q = $('#' + qid); if (!g || !q) return;
      const gpu = Number(g.dataset.gpu);
      g.oninput = () => { q.value = Math.round((Number(g.value) || 0) / gpu * 100) / 100; q.dataset.fromG = '1'; q.dispatchEvent(new Event('input')); };
      q.addEventListener('input', () => { if (q.dataset.fromG) { delete q.dataset.fromG; return; } g.value = r0((Number(q.value) || 0) * gpu); });
    };
    syncG('fgram', 'fqty'); syncG('egram', 'eqty');
    const mt = n => `Protein ${r0(n.pro || 0)} g · Fiber ${r0(n.fib || 0)} g · Carbs ${r0(n.carb || 0)} g · Fat ${r0(n.fat || 0)} g`;
    const fq = $('#fqty'); if (fq) fq.oninput = () => {
      m.qty = fq.value; const f = I().foodById.get(m.food), u = $('#funit') ? $('#funit').value : f.unit, n = nutrFor(f, fq.value, u);
      $('#fcal').textContent = fmt(n.cal); $('#fmac').textContent = mt(n);
    };
    const fu = $('#funit'); if (fu) fu.onchange = () => {
      // keep the same amount of food when switching units
      const f = I().foodById.get(m.food), prev = m.unit || f.unit, base = toFoodUnits(f, fq.value, prev);
      m.unit = fu.value; fq.value = Math.round(base / toFoodUnits(f, 1, fu.value) * 100) / 100; fq.dispatchEvent(new Event('input'));
    };
    const eq = $('#eqty'); if (eq) eq.oninput = () => {
      const l = m.entry, f = l.food && I().foodById.get(l.food);
      if (f) {
        const n = nutrFor(f, eq.value, $('#eunit') ? $('#eunit').value : l.unit);
        $('#ecal').textContent = fmt(n.cal); const em = $('#emac'); if (em) em.textContent = mt(n);
      } else {
        const c = l.cal / (l.qty || 1) * (Number(eq.value) || 0);
        $('#ecal').textContent = fmt(c); const ci = $('#ecalin'); if (ci) ci.value = r0(c);
      }
    };
    const eu = $('#eunit'); if (eu) { let prevU = eu.value; eu.onchange = () => {
      const f = I().foodById.get(m.entry.food), base = toFoodUnits(f, eq.value, prevU);
      eq.value = Math.round(base / toFoodUnits(f, 1, eu.value) * 100) / 100; prevU = eu.value; eq.dispatchEvent(new Event('input'));
    }; }
    document.querySelectorAll('[data-frac]').forEach(b => b.onclick = () => {
      const inp = $('#eqty') || $('#fqty'); if (!inp) return;
      inp.value = Math.round((Math.floor(Number(inp.value) || 0) + Number(b.dataset.frac)) * 1000) / 1000; inp.dispatchEvent(new Event('input'));
    });
  }
  function modalAct(a) {
    const m = state.modal;
    if (a === 'close') return closeModal();
    if (a === 'back') { stopScan(); state.modal = m.back; return renderModal(); }
    if (a === 'foodsave') {
      const f = I().foodById.get(m.food), qty = Number($('#fqty').value);
      if (!(qty > 0)) return toast('Enter an amount');
      closeModal(); return addEntries([entryFromFood(f, qty, m.slot, $('#funit') ? $('#funit').value : f.unit)]);
    }
    if (a === 'mealsave') {
      const es = m.group.items.map(x => {
        const f = x.food && I().foodById.get(x.food);
        return f ? entryFromFood(f, x.qty, m.slot) : { food: '', meal: m.slot, name: x.name, qty: x.qty, unit: x.unit, cal: x.cal, pro: x.pro, fib: x.fib, carb: x.carb, fat: x.fat, est: x.est };
      });
      closeModal(); return addEntries(es);
    }
    if (a === 'quicksave') {
      const name = ($('#qname').value || '').trim(); if (!name) return toast('Type what you ate');
      const cal = Number($('#qcal').value) || 0;
      closeModal(); return addEntries([{ food: '', meal: m.slot || defaultSlot(), name, qty: 1, unit: 'Serving', cal, pro: null, fib: null, carb: null, fat: null, est: true }]);
    }
    if (a === 'entrysave') {
      const l = m.entry, qty = Number($('#eqty').value); if (!(qty > 0)) return toast('Enter an amount');
      const f = l.food && I().foodById.get(l.food);
      if (f) Object.assign(l, entryFromFood(f, qty, $('#emeal').value, $('#eunit') ? $('#eunit').value : l.unit), { id: l.id, date: l.date, time: l.time, planned: l.planned });
      else { const ci = $('#ecalin'); l.qty = qty; l.cal = ci ? Number(ci.value) || 0 : l.cal; l.meal = $('#emeal').value; }
      persist(); enqueue('updateLog', { id: l.id, entry: l }); closeModal(); return render();
    }
    if (a === 'entryate') { const l = m.entry; markPlanned(l, false); closeModal(); render(); return toast('Confirmed', 'Undo', () => { markPlanned(l, true); render(); }); }
    if (a === 'entryplan') { const l = m.entry; markPlanned(l, true); closeModal(); render(); return toast('Moved back to planned', 'Undo', () => { markPlanned(l, false); render(); }); }
    if (a === 'entrydel') {
      const l = m.entry; state.data.log = state.data.log.filter(x => x !== l); persist();
      enqueue('deleteLog', { id: l.id }); closeModal(); render(); return toast('Deleted');
    }
    if (a === 'exsave') {
      const name = ($('#xname').value || '').trim(), cal = Number($('#xcal').value);
      if (!name || !(cal > 0)) return toast('Activity and calories, please');
      const e = { id: uid('X'), date: state.date, name, min: Number($('#xmin').value) || null, cal, source: 'Manual' };
      state.data.exercise.push(e); ensureLocalDay(state.date); persist();
      enqueue('addExercise', { entry: e, budget: budgetFor(state.date) }); closeModal(); return render();
    }
    if (a === 'scan') { state.modal = { type: 'scan', back: m }; renderModal(); return startScan(); }
    if (a === 'bcgo') return lookupBarcode($('#bcin').value);
    if (a === 'tellsave') {
      const msg = ($('#tellmsg').value || '').trim(); if (!msg) return toast('Type or dictate a message');
      enqueue('append', { tab: 'Feedback', headers: ['Date', 'Time', 'Person', 'For', 'Message', 'Status', 'EntryID'],
        rows: [{ Date: today(), Time: nowHM(), Person: PERSON, For: m.to, Message: msg, Status: 'New', EntryID: uid('T') }] });
      closeModal(); return toast(`Saved for your ${m.to.toLowerCase()}`);
    }
    if (a === 'exupd') {
      const e = m.entry, cal = Number($('#xcal').value); if (!(cal >= 0)) return toast('Enter calories');
      e.cal = cal; e.min = Number($('#xmin').value) || null; persist();
      enqueue('update', { tab: 'Exercise', id: e.id, values: { Minutes: e.min ?? '', Calories: cal } }); closeModal(); render(); return toast('Saved');
    }
    if (a === 'exdel') {
      const e = m.entry; state.data.exercise = state.data.exercise.filter(x => x !== e); persist();
      enqueue('deleteExercise', { id: e.id }); closeModal(); return render();
    }
  }

  // ---------- start ----------
  // iPad home-screen app: iPadOS blurs a band under the status bar; css pushes the header below it
  const markIpad = () => document.documentElement.classList.toggle('ipad-app', (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) && Math.min(innerWidth, innerHeight) >= 700);
  markIpad(); addEventListener('resize', markIpad);
  appStart();
  render();
  refresh();
  let openedOn = today();
  async function checkVersion() {
    try {
      const v = await (await fetch('../version.json?t=' + Date.now(), { cache: 'no-store' })).json();
      const seen = load('version', null);
      if (seen && v.version !== seen && !state.queue.length && !state.modal) {
        save('version', v.version);
        // reload with a fresh URL so the page itself can't come from cache
        const u = new URL(location.href); u.searchParams.set('r', Date.now()); location.replace(u.toString()); return true;
      }
      save('version', v.version);
    } catch (e) {}
    return false;
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (await checkVersion()) return;
    if (openedOn !== today()) { openedOn = today(); state.date = today(); }
    refresh();
  });
  checkVersion();
  window.addEventListener('online', flush);
  window.FL_DEBUG = { state, I, suggestions, rewards };
})();
