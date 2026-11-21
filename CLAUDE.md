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
