# Food Log

Lightweight calorie log for Josh (and later Michelle), replacing Lose It!. Follow the `josh-app-dev` skill for shared conventions.

- App: static files on GitHub Pages. `josh/` and `michelle/` are per-person entry pages; shared code in `app.js`, `app.css`, `config.js`.
- Data: Google Sheet "Food_Log" (id `1FQtRjM5_zUAw83Yoq-bi9l8X_Pwzqi9OX6lyKZrub0w`), tabs Profiles, Foods, Meals, Log, Exercise, Days, Body, Plan, Feedback.
- API: `apps-script/Code.gs`, deployed by Josh as a web app. Prefer the generic actions (`read`, `append`, `update`, `delete`) for new features so the script doesn't need redeploying.
- Every push: bump `version.json` so open apps reload to the new version.
- Test before pushing: `python3 -I ../fltest/test_app.py` style Playwright run with the API stubbed via page.route.

## Status (2026-11-20 night)
Done: phases 1-2, plan view (Mifflin-St Jeor x1.2 + manual adjustment + weekly goal + weekend extra), week projection, Lose It! plan copied through Nov 30, Michelle's profile + Withings weigh-ins (Withings user MD, id 762641; Josh is 243567), barcode scanning (ZXing from jsdelivr + Open Food Facts), feedback tab.

## Done 2026-11-20 late
- loseit-dietitian skill reworked: Food_Log sheet primary, "Mirror to Lose It!: ON", Withings -> Body for both, Workout Buddy calories -> Exercise (EntryID WB-<Row ID>), Nightly plan refresh steps moved into the skill.
- Scheduled tasks: "Dietitian plan refresh" (was Lose It! plan refresh) and "Workout Buddy calories (sheet + Lose It!)" now just point at the skill. workout-trainer and the morning brief already delegate to the dietitian skill, so no change.

## At cutover (when Josh says drop Lose It!)
- Remove the mirror line and Lose It! sections from loseit-dietitian (consider renaming it), drop Lose It! from site-login-check and the morning brief's sign-in line, rename the hourly task.

## Done 2026-11-20 late (2)
- Saved meals (Meals tab, items JSON; added as separate tickable Log rows), Copy a day (planned if future, exercise Source 'Copied'), Foods N:O formulas pasted as values. Code.gs addFood_ now writes 0/blank for Times used/Last used (redeploy 2026-11-20).

## Open
- Barcode scan confirmed working on Josh's phone 2026-11-20.
- Michelle's dietitian: drafted 2026-11-21 as `michelle-dietitian` (lives in her Claude) on top of the shared `food-log-sheet` skill, which now holds the sheet layout, budget math and writing rules (loseit-dietitian references it instead of repeating them). Josh's dietitian logs Michelle's Workout Buddy calories into Exercise (Person Michelle, no Lose It! mirror). Waiting on Michelle to upload the skills and add her nightly task.
- Michelle's Cal AI history import: not started.

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
- Removed the + nav button 2026-11-21 (Josh may revisit as a quick-add: Food by time of day / Scan / Exercise, for today). The 'add' act handler is still in app.js.
- Progress card: Weight / Fat mass toggle (localStorage progMetric). Goals in Profiles: 'Fat mass goal (lb)' + 'Goal date', 'Weight goal (lb)' + 'Weight goal date' (columns P:Q added 2026-11-21).

## Apple Watch workouts (2026-11-21; needs one redeploy)
- iPhone Shortcuts can't read Health workouts (no Workouts type in Find Health Samples on Josh's iOS), so the shortcut plan was dropped. Health Auto Export (paid iPhone app, REST API automation, Workouts, JSON) posts to the script URL with `?source=hae&person=<Josh|Michelle>&key=<API_KEY>` (Apps Script can't read headers). doPost routes that to `haeWorkouts_`, which maps the watch name via `HAE_ACTIVITY` (unlisted names kept as-is), takes activeEnergyBurned (or activeEnergy; kJ converted) and calls `addExercise_` with Source `Apple Watch`, EntryID `AW-<start yyyyMMddHHmm>`; repeats are skipped, so a look-back window is safe.
- Settings > Apple Watch card: last Apple Watch row received + "Copy Health Auto Export URL" (each person's own link).
- Workout Buddy setting `Watch Calories` = `Shortcut` (per person) stops its keypad once that person's watch workouts arrive; loseit-dietitian mirrors Josh's Apple Watch rows to Lose It!, drops planned rows they replace, and flags sessions that never arrived.

## Feedback batch 2026-11-21 afternoon (no redeploy)
- Swipe left on a log entry reveals Delete (bindSwipe/swipeDelete; Undo re-adds via addLog). Food list: restaurant tag + "last <day>" (from the 365-day log). defaultAmount(): restaurant food with a Servings 'Serving' row opens at 1 serving. Day view shows "Saved as <meal>" when a slot's foods match a saved meal. foodSheet's first calorie figure now converts units (toFoodUnits).
- Foods brands filled 2026-11-21: 62 from names, 9 from always-co-logged restaurant; F00591 "French Fries, Medium" (128 g) left without a brand (used at both Whataburger and McDonald's); new F01616 McDonald's World Famous Fries, Medium (320 cal, US posted).
