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
      state.data = j; persist(); state.error = ''; render();
    } catch (e) { state.error = String(e.message || e); if (state.data) renderSync(); else render(); }
  }
  const persist = () => { save('data', state.data); idx = null; };

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
  function budgetFor(date) {
    const { dayByDate, planByDate } = I();
    if (dayByDate.get(date)?.budget) return dayByDate.get(date).budget;
    if (planByDate.get(date)?.target) return planByDate.get(date).target;
    const prior = state.data.days.filter(x => x.date <= date && x.budget).pop() || state.data.days.filter(x => x.budget).pop();
    return prior ? prior.budget : 2000;
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
      if (!prev || prev.date <= l.date) lastQty.set(l.food, { date: l.date, qty: l.qty });
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
    return `<header class="top"><div class="top-row"><h1>${esc(PERSON)}</h1></div><div class="sync" id="sync"></div></header>`;
  }
  function renderSync() {
    const el = $('#sync'); if (!el) return;
    const n = state.queue.length;
    el.className = 'sync' + (state.error ? ' warn' : '');
    el.textContent = state.error ? `Not synced${n ? ` (${n} waiting)` : ''}: ${state.error}` : state.syncing ? 'Saving…' : n ? `${n} waiting to save` : '';
  }
  function nav() {
    const b = (v, i, t) => `<button class="${state.view === v ? 'on' : ''}" data-view="${v}"><span class="i">${i}</span>${t}</button>`;
    return `<nav class="tabs">${b('day', '📅', 'Day')}${b('week', '📊', 'Week')}<button class="plus" data-act="add">+</button>${b('settings', '⚙️', 'Settings')}<button data-act="refresh"><span class="i">⟳</span>Sync</button></nav>`;
  }

  function dayView() {
    const x = dayTotals(state.date), over = x.left < 0;
    const cap = x.budget + x.burned, pct = cap > 0 ? Math.min(100, x.eaten / cap * 100) : 0;
    const markPct = cap > 0 ? Math.min(100, x.budget / cap * 100) : 0;
    let h = `<section class="card"><div class="summary">
      <div><b>${fmt(x.budget)}</b><span>Budget</span></div><div><b>${fmt(x.eaten)}</b><span>Food</span></div>
      <div><b>${fmt(x.burned)}</b><span>Exercise</span></div><div class="left ${over ? 'over' : ''}"><b>${fmt(Math.abs(x.left))}</b><span>${over ? 'Over' : 'Left'}</span></div></div>
      <div class="bar"><div class="fill ${over ? 'over' : ''}" style="width:${pct}%"></div>${x.burned ? `<div class="mark" style="left:${markPct}%"></div>` : ''}</div>
      <div class="macros"><span>Protein ${r0(x.pro)} g</span><span>Fiber ${r0(x.fib)} g</span></div></section>`;
    for (const slot of visibleSlots()) {
      const items = x.log.filter(l => l.meal === slot);
      const tot = items.reduce((a, l) => a + (l.cal || 0), 0);
      h += `<section class="card"><h2>${slot}<small>${items.length ? fmt(tot) + ' cal' : ''}</small></h2>
        ${items.map(l => `<button class="entry" style="width:100%;text-align:left" data-entry="${esc(l.id || '')}" data-ekey="${esc(entryKey(l))}">
          <div class="nm"><div>${esc(l.name)}${l.est ? '<span class="est">EST</span>' : ''}</div><small>${esc(qtyText(l))}</small></div><div class="cal">${fmt(l.cal)}</div></button>`).join('')}
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
      rows += `<button class="week-row ${isToday ? 'today' : ''} ${kind === 'planned' || kind === 'assumed' ? 'proj' : ''}" style="width:100%;text-align:left" data-goto="${d}">
        <div class="d">${parse(d).toLocaleDateString(undefined, { weekday: 'short' })}<small>${kind === 'planned' ? 'planned' : kind === 'assumed' ? 'avg' : parse(d).getDate()}</small></div>
        <div class="bar" style="margin:0"><div class="fill ${val !== null && val < 0 ? 'over' : ''} ${kind === 'assumed' ? 'ghost' : ''}" style="width:${val !== null ? w : 0}%"></div></div>
        <div class="v ${val === null ? '' : val < 0 ? 'over' : 'under'}">${val !== null ? sign(val) : '—'}</div></button>`;
    }
    const weekOver = ws > t, weekPast = addDays(ws, 6) < t;
    const box = (label, v) => `<div class="sub" style="margin:0">${label}</div><div class="wk-total ${v < 0 ? 'over' : 'under'}">${fmt(Math.abs(v))} cal ${v < 0 ? 'over' : 'under'}</div>`;
    let top = '';
    if (weekPast) top = box('Week total', tot);
    else {
      top = `<div class="wk-split">${weekOver ? '' : `<div>${box('So far', tot)}</div>`}<div>${box('Projected by Sunday', proj)}</div></div>`;
      if (assumed.length) top += `<div class="sub" style="margin:8px 0 0">Assuming ${fmt(avg)} cal a day (your recent average) for ${assumed.join(', ')}, with nothing planned yet</div>`;
    }
    return `<section class="card">${top}</section>
      <section class="card">${rows}<div class="sub" style="margin:8px 0 0">Under (−) or over (+) each day. Faded rows are projected.</div></section>`;
  }
  function settingsView() {
    const rw = rewards(), vs = visibleSlots();
    return `<section class="card"><h2>Level ${rw.level}<small>${fmt(rw.xp)} XP</small></h2>
      <div class="level"><div class="ring" style="--p:${rw.pct}"><span>${rw.level}</span></div>
      <div>${fmt(rw.toNext)} XP to level ${rw.level + 1}<br><small style="color:var(--muted)">Streak ${rw.st} days · best ${rw.best}</small></div></div></section>
      <section class="card"><h2>Badges</h2><div class="badges">${rw.badges.map(([e, n, got]) => `<div class="badge ${got ? 'got' : ''}"><span class="e">${e}</span>${esc(n)}</div>`).join('')}</div>
      <div class="sub" style="margin:10px 0 0">XP: 10 per day logged, +10 for done, +15 for done under budget, +25 per week of streak</div></section>
      <section class="card"><h2>Meal sections</h2>${ALL_SLOTS.map(s => `<div class="toggle-row"><span>${s}</span><button class="switch ${vs.includes(s) ? 'on' : ''}" data-slot="${s}"></button></div>`).join('')}</section>
      <section class="card"><h2>Extras</h2><div class="toggle-row"><span>Track water</span><button class="switch ${waterOn() ? 'on' : ''}" data-act="water"></button></div></section>
      <section class="card"><div class="sub" style="margin:0">Data: Food_Log sheet · ${state.data.foods.length.toLocaleString()} foods · last sync ${esc(new Date(state.data.serverTime || Date.now()).toLocaleString())}</div></section>`;
  }

  // ---------- modals ----------
  function openModal(m) { state.modal = m; renderModal(); }
  function closeModal() { state.modal = null; const o = $('#overlay'); if (o) o.remove(); }
  function renderModal() {
    let o = $('#overlay');
    if (!o) { o = document.createElement('div'); o.id = 'overlay'; o.className = 'overlay'; document.body.appendChild(o);
      o.addEventListener('click', e => { if (e.target === o) closeModal(); }); }
    const m = state.modal;
    const body = m.type === 'add' ? addSheet(m) : m.type === 'food' ? foodSheet(m) : m.type === 'entry' ? entrySheet(m)
      : m.type === 'quick' ? quickSheet(m) : m.type === 'ex' ? exSheet(m) : m.type === 'meal' ? mealSheet(m) : m.type === 'tell' ? tellSheet(m) : '';
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
      list = `<input id="q" class="search" placeholder="Search your foods" value="${esc(m.q || '')}" autocomplete="off">
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
  function foodSheet(m) {
    const f = I().foodById.get(m.food); const qty = m.qty;
    const k = (Number(qty) || 0) / f.per;
    return head(f.name, true) + `<div class="sheet-body">
      <div class="big-cal" id="fcal">${fmt(f.cal * k)}</div><div class="sub">calories · ${esc(m.slot)}</div>
      <div class="field"><label>Amount (${esc(f.unit)})</label><div class="qty-row"><input id="fqty" type="number" inputmode="decimal" step="any" value="${esc(qty)}"></div></div>
      <div class="sub" id="fmac">Protein ${r0((f.pro || 0) * k)} g · Fiber ${r0((f.fib || 0) * k)} g · Carbs ${r0((f.carb || 0) * k)} g · Fat ${r0((f.fat || 0) * k)} g</div>
      <button class="btn big" data-m="foodsave">Add</button></div>`;
  }
  function entrySheet(m) {
    const l = m.entry, f = l.food && I().foodById.get(l.food);
    const editable = !!l.id;
    return head(l.name) + `<div class="sheet-body"><div class="big-cal" id="ecal">${fmt(l.cal)}</div><div class="sub">${esc(l.meal)} · ${esc(qtyText(l))}${l.est ? ' · estimate' : ''}</div>
      ${editable ? `<div class="field"><label>Amount (${esc(l.unit || '')})</label><input id="eqty" type="number" inputmode="decimal" step="any" value="${esc(+Number(l.qty).toFixed(2))}"></div>
        ${!f ? `<div class="field"><label>Calories</label><input id="ecalin" type="number" inputmode="numeric" value="${r0(l.cal)}"></div>` : ''}
        <div class="field"><label>Meal</label><select id="emeal">${ALL_SLOTS.map(s => `<option ${s === l.meal ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <button class="btn big" data-m="entrysave">Save</button><button class="danger" data-m="entrydel">Delete entry</button>`
      : `<div class="sub">Imported from Lose It!. Edit older entries in the sheet.</div>`}</div>`;
  }
  function quickSheet(m) { return head('Quick entry') + `<div class="sheet-body">${quickForm(m)}</div>`; }
  function exSheet(m) {
    if (m.entry) return head(m.entry.name) + `<div class="sheet-body"><div class="big-cal">${fmt(m.entry.cal)}</div><div class="sub">calories burned</div>
      ${m.entry.id ? '<button class="danger" data-m="exdel">Delete exercise</button>' : '<div class="sub">Imported entry. Edit it in the sheet.</div>'}</div>`;
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

  // ---------- actions ----------
  function addEntries(entries) {
    entries.forEach(e => { e.id = uid('L'); e.date = state.date; e.time = state.date === today() ? nowHM() : ''; state.data.log.push(e); });
    ensureLocalDay(state.date);
    persist();
    enqueue('addLog', { entries: entries.map(e => ({ ...e })), budget: budgetFor(state.date) });
    render();
    const x = dayTotals(state.date);
    toast(`Added · ${fmt(Math.abs(x.left))} ${x.left < 0 ? 'over' : 'left'}`);
  }
  function ensureLocalDay(date) {
    if (!I().dayByDate.has(date)) { state.data.days.push({ date, budget: budgetFor(date), done: false, water: 0 }); idx = null; }
  }
  function entryFromFood(f, qty, slot) {
    const k = (Number(qty) || 0) / f.per;
    const rnd = v => v == null ? null : Math.round(v * k * 10) / 10;
    return { food: f.id, meal: slot, name: f.name, qty: Number(qty), unit: f.unit, cal: Math.round(f.cal * k * 10) / 10,
      pro: rnd(f.pro), fib: rnd(f.fib), carb: rnd(f.carb), fat: rnd(f.fat), est: !!f.est };
  }
  function setDayFlag(fields) {
    ensureLocalDay(state.date);
    Object.assign(I().dayByDate.get(state.date), fields);
    persist(); enqueue('setDay', { date: state.date, budget: budgetFor(state.date), ...fields }); render();
  }
  let toastT;
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2200);
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
      state.modal = { type: 'food', food: f.id, qty: lq ? +Number(lq.qty).toFixed(2) : f.per, slot: m.slot, back: m }; renderModal();
      setTimeout(() => { const i = $('#fqty'); if (i) { i.focus(); i.select(); } }, 50);
    });
    document.querySelectorAll('[data-meal]').forEach(b => b.onclick = () => {
      state.modal = { type: 'meal', group: m._meals[Number(b.dataset.meal)], slot: m.slot, back: m }; renderModal();
    });
    const fq = $('#fqty'); if (fq) fq.oninput = () => {
      m.qty = fq.value; const f = I().foodById.get(m.food), k = (Number(fq.value) || 0) / f.per;
      $('#fcal').textContent = fmt(f.cal * k);
      $('#fmac').textContent = `Protein ${r0((f.pro || 0) * k)} g · Fiber ${r0((f.fib || 0) * k)} g · Carbs ${r0((f.carb || 0) * k)} g · Fat ${r0((f.fat || 0) * k)} g`;
    };
    const eq = $('#eqty'); if (eq) eq.oninput = () => {
      const l = m.entry, f = l.food && I().foodById.get(l.food);
      const c = f ? f.cal / f.per * (Number(eq.value) || 0) : l.cal / (l.qty || 1) * (Number(eq.value) || 0);
      $('#ecal').textContent = fmt(c); const ci = $('#ecalin'); if (ci) ci.value = r0(c);
    };
  }
  function modalAct(a) {
    const m = state.modal;
    if (a === 'close') return closeModal();
    if (a === 'back') { state.modal = m.back; return renderModal(); }
    if (a === 'foodsave') {
      const f = I().foodById.get(m.food), qty = Number($('#fqty').value);
      if (!(qty > 0)) return toast('Enter an amount');
      closeModal(); return addEntries([entryFromFood(f, qty, m.slot)]);
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
      if (f) Object.assign(l, entryFromFood(f, qty, $('#emeal').value), { id: l.id, date: l.date, time: l.time });
      else { const ci = $('#ecalin'); l.qty = qty; l.cal = ci ? Number(ci.value) || 0 : l.cal; l.meal = $('#emeal').value; }
      persist(); enqueue('updateLog', { id: l.id, entry: l }); closeModal(); return render();
    }
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
    if (a === 'tellsave') {
      const msg = ($('#tellmsg').value || '').trim(); if (!msg) return toast('Type or dictate a message');
      enqueue('append', { tab: 'Feedback', headers: ['Date', 'Time', 'Person', 'For', 'Message', 'Status', 'EntryID'],
        rows: [{ Date: today(), Time: nowHM(), Person: PERSON, For: m.to, Message: msg, Status: 'New', EntryID: uid('T') }] });
      closeModal(); return toast(`Saved for your ${m.to.toLowerCase()}`);
    }
    if (a === 'exdel') {
      const e = m.entry; state.data.exercise = state.data.exercise.filter(x => x !== e); persist();
      enqueue('deleteExercise', { id: e.id }); closeModal(); return render();
    }
  }

  // ---------- start ----------
  appStart();
  render();
  refresh();
  let openedOn = today();
  async function checkVersion() {
    try {
      const v = await (await fetch('../version.json?t=' + Date.now(), { cache: 'no-store' })).json();
      const seen = load('version', null);
      if (seen && v.version !== seen && !state.queue.length && !state.modal) { save('version', v.version); location.reload(); return true; }
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
