# PilotVerdict 0.5.1

Compare workflow costs, check AI answers against approved rules, and keep the next decision in one report.

## Run

Node 22+, Python 3.12+. No runtime npm dependencies.

```sh
npm test
npm run build
python -m http.server 4173
```

Open `http://localhost:4173/`. The standalone `preview/index.html` also works by opening it in a normal browser.

## What is included

- Original white/blue PilotVerdict design, Aleo/Host Grotesk typography and rounded controls.
- A single project with Your work, Costs, Check answers and Results.
- Own-input and example paths; aggregate CSV and response CSV imports.
- Current/rules/AI cost comparison, source-linked human reviews, correction records and retests.
- Quality-to-cost linkage, sensitivity, JSON save/resume, HTML report.

The example is sample data. Cost outputs are estimates based on user inputs. Actual customer outcomes are not asserted.

## Checks

`npm test` runs the unit suite. `python scripts/release_browser_test.py` starts a real HTTP server and tests Chromium, including new inputs, downloads, local save/restore and invalidation. Optional `--adapted` is a restricted-environment check and does not certify HTTP or localStorage. Browser QA artifacts are in `qa/`.

## Source and credit

Preserved cost/CSV modules: StutiJohri/pilotverdict at b4197583d0768ca663fe92d7ca66ca36793a1c12. Shared project engine from the v0.5.0-rc1 supplied archive. UI restoration and integration use the approved GitHub homepage reference. Developed for Stuti Johri's product project with Nicolò Bonacorsi and AI-assisted engineering.

## Data

App inputs are local to the browser. Saving/exporting requires the recorded permission. Saved files and localStorage are not encrypted by this app. Google Fonts supplies the original typefaces; no font binaries are included.
