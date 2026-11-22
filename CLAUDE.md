# Food Log

Lightweight calorie log for Josh (and later Michelle), replacing Lose It!. Follow the `josh-app-dev` skill for shared conventions.

- App: static files on GitHub Pages. `josh/` and `michelle/` are per-person entry pages; shared code in `app.js`, `app.css`, `config.js`.
- Data: Google Sheet "Food_Log" (id `1FQtRjM5_zUAw83Yoq-bi9l8X_Pwzqi9OX6lyKZrub0w`), tabs Profiles, Foods, Meals, Log, Exercise, Days, Body, Plan, Feedback, Coach Notes, Exercises, Servings, Day Plans.
- API: `apps-script/Code.gs`, deployed by Josh as a web app. Prefer the generic actions (`read`, `append`, `update`, `delete`) for new features so the script doesn't need redeploying.
- Every push: bump `version.json` so open apps reload to the new version.
- Test before pushing: `python3 -I ../fltest/test_app.py` style Playwright run with the API stubbed via page.route.

## Status (2026-11-20 night)
Done: phases 1-2, plan view (Mifflin-St Jeor x1.2 + manual adjustment + weekly goal + weekend extra), week projection, Lose It! plan copied through Nov 30, Michelle's profile + Withings weigh-ins (Withings user MD, id 762641; Josh is 243567), barcode scanning (ZXing from jsdelivr + Open Food Facts), feedback tab.

## Done 2026-11-20 late
- loseit-dietitian skill reworked: Food_Log sheet primary, "Mirror to Lose It!: ON", Withings -> Body for both, Workout Buddy calories -> Exercise (EntryID WB-<Row ID>), Nightly plan refresh steps moved into the skill.
- Scheduled tasks: "Dietitian plan refresh" (was Lose It! plan refresh) and "Workout Buddy calories (sheet + Lose It!)" now just point at the skill. workout-trainer and the morning brief already delegate to the dietitian skill, so no change.

## Cutover done (2026-11-21)
- Josh switched fully to Food Log. loseit-dietitian rewritten with no Lose It! steps (slug kept so tasks still find it; Withings stays in Chrome). site-login-check checks Withings only; morning brief reads the Body tab. Scheduled tasks: "Workout Buddy calories (Food Log)" (renamed, sheet only), "Dietitian plan refresh" and "Workout Buddy trainer (nightly)" prompts no longer mention Lose It!. Planned exercise Source is now "Plan" (older rows "Lose It! plan", treated the same).

## Done 2026-11-20 late (2)
- Saved meals (Meals tab, items JSON; added as separate tickable Log rows), Copy a day (planned if future, exercise Source 'Copied'), Foods N:O formulas pasted as values. Code.gs addFood_ now writes 0/blank for Times used/Last used (redeploy 2026-11-20).

## Open
- Barcode scan confirmed working on Josh's phone 2026-11-20.
- Michelle's dietitian: `michelle-dietitian` skill, hosted in Josh's Claude (run in his "Dietitian plan refresh" task), on top of the shared `food-log-sheet` skill. Josh's dietitian logs her Workout Buddy calories and Withings weigh-ins. Waiting on: her reply to the starter email (goals) and her Health Auto Export setup (then set her WB `Watch Calories` = `Shortcut`).
- Michelle's Cal AI history import: dropped (2026-11-21, little data there).

## Done 2026-11-21
- Change log: `changelog.json` + "What's new" line in the About card (Settings tab), fetched only when opened; dot until read (`newsSeen`/`latestNews` in localStorage). Every push adds an entry in the same commit as the version.json bump.
- Fix: About redraws after the first version check, so a fresh install no longer shows "App version ?".
- Note: `checkVersion()` and the `visibilitychange` reload were always working; an earlier "bug" came from a web fetch truncating app.js.
- Tested in headless Chrome (Playwright, /usr/bin/google-chrome) at 390x844 and 820x1180.

## Exercise work (built 2026-11-21, no redeploy)
- `Exercises` tab (shared): ExerciseID, Activity, Josh cal/min, Michelle cal/min, Notes; seeded from each person's last 20 entries (dropped Calorie Burn Bonus, HealthKit Workout; Eliptical merged into Elliptical). App adds a new activity with his rate when both numbers are entered.
- Rate used for estimates: person's last 10 done, non-estimated entries for that activity, else library rate. The field he types is never overwritten; the filled one is marked EST and saved with Estimate = Yes.
- Exercise tab now has Planned (H) and Estimate (added by gUpdate_). Read via generic `read` (last 30 days), written via generic `update` after `addExercise`. Blank Planned = planned if date > today or Source 'Lose It! plan'.
- Planned burn counts toward Left like planned food (Days formula unchanged).
- Settings tab (view 'prefs', ⚙️) replaced the Sync nav button: Sync card, Meal sections, Extras, About. Plan (view 'settings') keeps plan, progress, level, badges.
- Removed the + nav button 2026-11-21; quick-add idea dropped (Josh, 2026-11-21). The 'add' act handler is still in app.js.
- Progress card: Weight / Fat mass toggle (localStorage progMetric). Goals in Profiles: 'Fat mass goal (lb)' + 'Goal date', 'Weight goal (lb)' + 'Weight goal date' (columns P:Q added 2026-11-21).

## Apple Watch workouts (2026-11-21; needs one redeploy)
- iPhone Shortcuts can't read Health workouts (no Workouts type in Find Health Samples on Josh's iOS), so the shortcut plan was dropped. Health Auto Export (paid iPhone app, REST API automation, Workouts, JSON) posts to the script URL with `?source=hae&person=<Josh|Michelle>&key=<API_KEY>` (Apps Script can't read headers). doPost routes that to `haeWorkouts_`, which maps the watch name via `HAE_ACTIVITY` (unlisted names kept as-is), takes activeEnergyBurned (or activeEnergy; kJ converted) and calls `addExercise_` with Source `Apple Watch`, EntryID `AW-<start yyyyMMddHHmm>`; repeats are skipped, so a look-back window is safe. IDs: Josh , others  (2026-11-22, after Michelle's 8:20 ride collided with Josh's; needs redeploy).  also skips her older unsuffixed rows (same person) so they aren't re-added.
- Settings > Apple Watch card: last Apple Watch row received + "Copy Health Auto Export URL" (each person's own link).
- Workout Buddy setting `Watch Calories` = `Shortcut` (per person) stops its keypad once that person's watch workouts arrive; loseit-dietitian drops planned rows Apple Watch rows replace, and flags sessions that never arrived.

## Feedback batch 2026-11-21 afternoon (no redeploy)
- Swipe left on a log entry reveals Delete (bindSwipe/swipeDelete; Undo re-adds via addLog). Food list: restaurant tag + "last <day>" (from the 365-day log). defaultAmount(): restaurant food with a Servings 'Serving' row opens at 1 serving. Day view shows "Saved as <meal>" when a slot's foods match a saved meal. foodSheet's first calorie figure now converts units (toFoodUnits).
- Foods brands filled 2026-11-21: 62 from names, 9 from always-co-logged restaurant; F00591 "French Fries, Medium" (128 g) left without a brand (used at both Whataburger and McDonald's); new F01616 McDonald's World Famous Fries, Medium (320 cal, US posted).
- 2026-11-21: Food_Log and Workout Buddy sheets switched from America/Los_Angeles to America/New_York (Code.gs reads TZ from the sheet; date-only values are TZ-free serials, so stored dates didn't move). HAE still uses each workout's own local time.

## Coach notes (2026-11-21)
- Coach Notes tab (Date, Time, Person, From, Message, Status New/Read, EntryID): dietitian messages, read via generic `read` after load (`loadCoach`), shown as a "From your dietitian" card at the top of today (unread only, last 3) with Got it (queued generic `update` Status = Read) and Reply (Tell my dietitian). Inbox: ✉️ `mailBtn()` top-right of every header (`.mail-row`, after the first top row) with an unread badge opens `coachSheet` (all notes, newest first, unread bold with Got it). The old "📬 Coach notes" link under the tell buttons was removed 2026-11-22.
- Fix 2026-11-22 (Josh: "saw a dietitian note but it disappeared"): `refresh()` replaced state.data without carrying `coach`, so returning to the app hid the card until loadCoach finished (or for good if that read failed). Now carried over like exLib/dayPlans. Test: `tests/test_inbox.py`.
- Michelle's dietitian (michelle-dietitian skill) and trainer run in Josh's Claude for now; nightly tasks reply through Coach Notes. Her goals come from her reply to Josh's starter email ("Your dietitian and trainer"); the CNGOAL note marks that step done.
- Michelle's setup link button removed 2026-11-21 (her devices are set up); a new device uses `michelle/?k=<key>`.
- Restaurant foods: 102 of 109 are already per Serving/Each/Piece, so no extra Servings rows needed.

## Barcode scanner v2 (2026-11-21)
- zxing-wasm 3.1.7 IIFE reader from jsdelivr (`ZXingWASM.readBarcodes`, formats EAN13/EAN8/UPCA/UPCE, tryHarder); its wasm loads from fastly.jsdelivr.net. Replaced @zxing/browser, which missed many codes on iPhone (640x480 stream).
- Live: getUserMedia 1920x1080 ideal, continuous focus and up to 2x zoom where supported; reads every ~120 ms, alternating the guide-box area (80% x 50%) and the full frame, downscaled to 1280 wide. "Take a photo instead" (`input capture=environment`) decodes a full-res still. Hint after 9 s.
- Saved-food barcode match ignores leading zeros (UPC-A vs EAN-13).
- Tested with Chrome's fake camera fed a blurred, rotated UPC-A (y4m) and a photo file, API and CDN stubbed.

## Target first (2026-11-21)
- Profiles column R `Show target first` (Yes/No; blank = on for Michelle only), toggled in Settings > Extras via `saveSettings`. On: the today card shows Target / Food / +Exercise / Left vs target, plus "N left of your target · M left with exercise". Set: Josh No, Michelle Yes.

## Quick entries become foods (2026-11-21)
- Quick entry has two buttons: "I'm sure of the calories" (Estimate No: the dietitian never changes calories) and "my dietitian can adjust" (Estimate Yes). Either way it adds a Foods row (Unit Serving, Per 1, cal as typed or 0, Source `Quick entry`) via `addFood` (temp id swapped on sync) and logs it with that FoodID, so it shows in search/suggestions. Same name + calories + sure/adjust choice reuses the existing food. The dietitians fill macros (and calories only when 0) nightly; they never change a number the person typed.

## USDA type-ahead (2026-11-21; deployed and FDC_KEY set by Josh, confirmed working)
- Code.gs `foodSearch` {q}: POST to FoodData Central /foods/search (Foundation, SR Legacy, Survey, Branded; pageSize 25) with Script Property `FDC_KEY` (DEMO_KEY fallback, 30/h), returns up to 15 {fdcId, name, brand, type, per100 {cal, pro, fib, carb, fat}, servingG, servingText}, deduped, kcal only, cached 6 h per query; skips the script lock. Key never goes in the repo (USDA deactivates keys found online).
- App: in My foods, after 3+ letters a "From USDA" section lists results not already in Foods (name|brand match, ALL-CAPS names title-cased). Tap = addFood (Unit Gram, per-gram values, Source `USDA <fdcId>`) + Servings 'Serving' row when the serving is in g/ml, then the food sheet. Before the redeploy the call fails quietly and the section hides.

## Add sheet steadiness (2026-11-21)
- While searching, renderModal swaps only `#addres` (results) when the same add modal/tab/slot is open (the meal chooser row was removed 2026-11-21: the slot comes from the tapped "+ Add food" and the title says "Add to <slot>"), so the `#q` input node, focus and iOS keyboard stay put; the add sheet is `.sheet.tall` (fixed 92% height) so it doesn't resize as results change; the overlay follows `visualViewport` (top/height) so the sheet sits above the keyboard; `html.modal-open` stops the page behind from scrolling.
- Search input: type=search, enterkeyhint=search, autocorrect/autocapitalize/spellcheck off. iOS's form bar (up/down/✓ above the keyboard) can't be hidden from a web page.

## Macro banner (2026-11-21)
- Today banner: Protein / Carbs / Fat / Fiber chips (`MACROS`, `state.macro`, not persisted). Tapping one shows that macro per entry (`macroCell`, blank = orange "— g") and per meal header; tap again clears. Macro goals (added same evening): Profiles S:V 'Protein goal (g)', 'Carbs goal (g)', 'Fat goal (g)', 'Fiber goal (g)' (blank = none), edited in Plan > Macro goals card via saveSettings. Chips show 'v / goal g' + bar; protein/fiber = minimum (green when met), carbs/fat = limit (red when over).

## Developer feedback 2026-11-21 night
- Bug (since 2026-11-20 unit dropdowns): foodsave called closeModal() before reading #funit, so the entry fell back to the food's base unit (2 Serving saved as 2 Gram). Now reads the unit first. Fixed Michelle's affected rows 10579, 10580, 10584 (Log). loadServings also keeps local servings (sv.local) the sheet doesn't have yet.
- .qty-row .field inputs shrink (min-width 0) so the iPad date box fits; Apple Watch card's HAE URL copy button removed (Josh: no longer needed); restored 2026-11-22 for Michelle (always shown on her page; on Josh's only until his first watch workout arrives).

## Meal Wizard (2026-11-21; no redeploy)
- 5th nav tab `wiz` (🪄 Wizard). Code: the "🪄 Meal Wizard" section of app.js (`wiz*`/`wz*`). State `state.wiz` saved in localStorage key `wiz` (date, items, ex, noEx, chk, tol, name). Runs fully in the browser on the 365-day bootstrap log; no new script actions.
- Targets: calories = `budgetFor(date)` + plan exercise; macros = Profiles goals (protein/fiber minimums, carbs/fat limits, as on the banner). `w.chk[k]` false = ignored (default on when a goal exists). Tolerance `w.tol` {cal 50, g 10}.
- Candidates (`wzCands`, cached): eaten Log rows of the last 180 days. Per food: slots it was logged in, and its logged amounts normalized by `wzPortion` (weight logs -> servings in 0.5 steps when the food has a Serving, else grams rounded to 5/10; other units to 0.25), top 4 by count. Saved meals count as one item when a date+slot's foods match one (`mealSig`). Foods with blank values for a checked macro are skipped. Slot habits: share of logged days a slot has food (rarely used slots stay empty most rolls) and its usual item count (cap 3).
- Wand (`wzSearch`): 30 restarts of weighted-random fill (weight sqrt(times eaten in that slot)) plus a 120-step hill climb (swap / other amount / add / remove) on a penalty past tolerance; any restart that meets all checked targets can win (weighted to familiar foods), so rerolls differ; else the closest, with misses shown ("Protein 18 g short"). Locked items stay (manual + pulled items start locked). No repeats in a day.
- Exercise: with "No additional exercise" off and food short, tries his top 4 activities of the last 180 days at median minutes/calories and suggests one (`kind 'suggest'`, Keep to make it real). Apply and Save skip unkept suggestions.
- Pull in day copies a day's Log/Exercise rows in as locked `pulled` items with `src` (row id) + `srcDate`; Apply skips those rows on their own date so nothing doubles.
- Apply: the wizard date plus chosen weekdays for 1-4 weeks (max 28 days, today or later). Per date and slot: if the slot has food (other than its own pulled rows) it's skipped, unless Replace is on and everything there is planned (then those planned rows are deleted first). Rows go through `addEntries` (+ `update` Planned = Yes for today); exercise via `addExercise` with Source `Plan` + Planned Yes, skipped if the day already has that activity.
- Day Plans tab (created by the first generic `append`; per person): PlanID (`DP...`), Person, Name, Items (JSON), Exercise (JSON), Calories, Protein (g), Carbs (g), Fat (g), Fiber (g), Updated, Notes. Items JSON: `[{slot, food (FoodID or ''), name, qty, unit, cal, pro, fib, carb, fat, est, group?, groupId?}]` (a saved meal is expanded to its foods with `group` = meal name, `groupId` = MealID). Exercise JSON: `[{name, min, cal}]`. Same name for the same person = update (generic `update`). Read via generic `read` (`loadDayPlans`, keeps queued changes). The dietitians use these when pre-filling days (food-log-sheet skill, "Saved day plans").
- Hooks: the add sheet/food/meal/quick-entry/exercise sheets check `wizOf(m)` (a `wiz: true` modal in the back chain) and drop results into the plan instead of the log.
- Tested: `tests/test_wiz.py` (Playwright, API stubbed; phone + iPad; blank-day wand, locks, swaps, unchecked targets, infeasible, exercise suggestion on/off, manual add, saved meal, pull in day, apply/replace/eaten-safe, save/load plans, Michelle page).
