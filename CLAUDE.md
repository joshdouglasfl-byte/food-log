# Food Log

Lightweight calorie log for Josh (and later Michelle), replacing Lose It!. Follow the `josh-app-dev` skill for shared conventions.

- App: static files on GitHub Pages. `josh/` and `michelle/` are per-person entry pages; shared code in `app.js`, `app.css`, `config.js`.
- Data: Google Sheet "Food_Log" (id `1FQtRjM5_zUAw83Yoq-bi9l8X_Pwzqi9OX6lyKZrub0w`), tabs Profiles, Foods, Meals, Log, Exercise, Days, Body, Plan, Feedback.
- API: `apps-script/Code.gs`, deployed by Josh as a web app. Prefer the generic actions (`read`, `append`, `update`, `delete`) for new features so the script doesn't need redeploying.
- Every push: bump `version.json` so open apps reload to the new version.
- Test before pushing: `python3 -I ../fltest/test_app.py` style Playwright run with the API stubbed via page.route.
