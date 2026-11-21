# Food Log

Lightweight calorie log for Josh (and later Michelle), replacing Lose It!. Follow the `josh-app-dev` skill for shared conventions.

- App: static files on GitHub Pages. `josh/` and `michelle/` are per-person entry pages; shared code in `app.js`, `app.css`, `config.js`.
- Data: Google Sheet "Food_Log" (id `1FQtRjM5_zUAw83Yoq-bi9l8X_Pwzqi9OX6lyKZrub0w`), tabs Profiles, Foods, Meals, Log, Exercise, Days, Body, Plan, Feedback.
- API: `apps-script/Code.gs`, deployed by Josh as a web app. Prefer the generic actions (`read`, `append`, `update`, `delete`) for new features so the script doesn't need redeploying.
- Every push: bump `version.json` so open apps reload to the new version.
- Test before pushing: `python3 -I ../fltest/test_app.py` style Playwright run with the API stubbed via page.route.

## Status (2026-11-20 night)
Done: phases 1-2, plan view (Mifflin-St Jeor x1.2 + manual adjustment + weekly goal + weekend extra), week projection, Lose It! plan copied through Nov 30, Michelle's profile + Withings weigh-ins (Withings user MD, id 762641; Josh is 243567), barcode scanning (ZXing from jsdelivr + Open Food Facts), feedback tab.

## Next (overnight)
1. Rework the `loseit-dietitian` skill so the Food_Log sheet is primary. During the parallel week Josh chose **write to both**: every plan/log change goes to the sheet AND is mirrored into Lose It! (Chrome) until he says cut over.
2. Withings -> Body tab (both people) as part of the dietitian/nightly run (Chrome, list view, attribute values to the following date line).
3. Workout Buddy watch calories -> Food_Log Exercise tab (Source "Workout Buddy"), plus the existing Lose It! entry while mirroring. Update the hourly "Workout Buddy to Lose It! (Mac)" task and the nightly trainer catch-up to reference the skill, not repeat it.
4. Review scheduled tasks and skills for overlap (site-login-check, workout-trainer, morning brief) per Josh's no-duplication rule.
5. Check Feedback tab for New developer items first.
