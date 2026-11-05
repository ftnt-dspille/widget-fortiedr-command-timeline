# Live check with docubot

`widgetcheck/chapter.spec.ts` opens a real alert in FortiSOAR and asserts the
Command Timeline widget (Story, folded lead-in, inline detail, Graph tab). It
also reports which generation of alert card the alert carries, and saves a few
screenshots for review under `.docubot/staging` (gitignored).

Setup: copy `labconfig.example.yaml` to `labconfig.yaml` (gitignored), or set
`DOCUBOT_SOAR_URL`, `DOCUBOT_SOAR_USER` and `DOCUBOT_SOAR_PASS`.

Run one spec from the docubot kit (`~/PycharmProjects/TEC/docubot`), never
`docubot run`, with `DOCUBOT_TARGET` set to this widget directory and
`ALERT_ID` set to the alert uuid. Use the kit's own Playwright binary with
`--config=playwright.config.ts --tsconfig=tsconfig.json` and the spec filter
`widgetcheck/chapter`.
