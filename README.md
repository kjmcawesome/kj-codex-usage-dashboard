# KJ Codex Usage Dashboard

Shareable Codex usage dashboard built from local `~/.codex` session logs.

- Public repo: `https://github.com/kjmcawesome/kj-codex-usage-dashboard`
- Public site: `https://kjmcawesome.github.io/kj-codex-usage-dashboard/`

## Live site

Primary review URL:

- `https://kjmcawesome.github.io/kj-codex-usage-dashboard/`

## Local shim

```bash
git clone git@github.com:kjmcawesome/kj-codex-usage-dashboard.git
cd codex-usage-dashboard
npm test
npm start
```

`npm start` no longer serves a separate local dashboard. It:

- starts or reuses the local refresh helper on `http://127.0.0.1:3185`
- redirects `http://localhost:3184` to the live GitHub Pages dashboard

This keeps review on the public site and avoids drift onto a stale local copy.

## Force rebuild helper

```bash
npm run helper:start
```

This runs the loopback helper that can rebuild the snapshot from `~/.codex` and publish `gh-pages` on demand.
When the helper is reachable, the dashboard button switches from `Check for updates` to `Force rebuild`.

## Install the force rebuild helper

```bash
npm run helper:install
```

This installs a macOS LaunchAgent that keeps the local refresh helper running on `127.0.0.1:3185`.

## Static export

```bash
npm run build:site
```

This writes:

- `public/data/usage-snapshot.json`
- `dist/` as the GitHub Pages-ready static site

## Publish to GitHub Pages

```bash
npm run publish:pages
```

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
- Estimated cost is derived from the published Codex token-based rate card embedded in the app and is displayed in Codex credit units.
- Cost estimates use uncached input at the model input rate, cached input at the cached-input rate, and `output_tokens + reasoning_output_tokens` at the model output rate.
- Exact billed cost is not available from local Codex logs, so the dashboard treats these as directional estimates.
- Range state is encoded in the page URL using either preset `days` or explicit `start_date` / `end_date`.
- `Force rebuild` on the public site uses the local helper to rebuild from local logs and republish if anything changed.
