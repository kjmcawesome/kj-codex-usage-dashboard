# KJ Codex Usage Dashboard

Shareable Codex usage dashboard built from local `~/.codex` session logs.

## Local preview

```bash
git clone <your-repo-url>
cd codex-usage-dashboard
npm test
npm start
```

`npm start` exports a fresh local snapshot, then serves the static site at `http://localhost:3184`.

## Static export

```bash
npm run build:site
```

This writes:

- `public/data/usage-snapshot.json` for local preview
- `dist/` as the GitHub Pages-ready static site

## Publish to GitHub Pages

```bash
npm run publish:pages
```

Expected repo setup:

- source branch: `main`
- Pages branch: `gh-pages`
- public site served from the root of `gh-pages`

`publish:pages` only pushes when the generated snapshot changed.

## Install scheduled updates

```bash
npm run schedule:install
```

This installs a macOS LaunchAgent that runs the Pages publish script every 30 minutes on weekdays from 8:00 AM through 6:00 PM local time.

## Data source

- Reads `~/.codex/sessions`
- Reads `~/.codex/archived_sessions`
- Reads `~/.codex/session_index.jsonl`
- Writes a derived cache to `~/.codex/cache/usage-dashboard-index.json`
- Vendors `flatpickr` locally under `public/vendor/flatpickr`

## Metric semantics

- `total_tokens` comes directly from Codex log snapshots and is treated as the source of truth.
- `cached_input_tokens` is a subset of input tokens, not an extra additive bucket.
- `reasoning_output_tokens` is tracked separately in the logs and is not included inside `total_tokens`.
- Public API equivalent is derived from published standard OpenAI API token rates that are embedded in the app, not from billed credits.
- Cost uses uncached input at the model input rate, cached input at the cached-input rate, and `output_tokens + reasoning_output_tokens` at the model output rate.
- Exact billed credits are not available from local Codex logs, so the dashboard shows credits as unavailable.
- Range state is encoded in the page URL using either preset `days` or explicit `start_date` / `end_date`.
