# KJ Codex Usage Dashboard

A project-cost view of KJ's Codex work, with a 365-day contribution board.
No framework, charting service, or model calls are required to collect or render usage.

## Where to view

- Public dashboard: https://kjmcawesome.github.io/kj-codex-usage-dashboard/?days=30&workspace=all&include_subagents=1
- OpenAI workspace Site: https://kj-codex-usage-dashboard.openai.chatgpt.site
- The two hosts use the same frontend and snapshot format. A Sites source deployment is separate from a GitHub snapshot publication.

## What the numbers mean

- Projects are named root conversations, not generic folders. Linked helpers and user forks roll into the originating project.
- A helper's copied parent history is not new usage. The collector matches inherited cumulative counter snapshots and ancestor turn IDs, excludes those replays, and retains only the helper's additional work.
- Duplicate cumulative snapshots within a session are ignored. A new counter reset uses the available last-request usage, rather than adding the previous high-water mark again.
- Input already includes cache reads and cache writes. Total tokens are input + output when the log supplies that breakdown. Reasoning is a subset of output, not an extra charge.
- USD amounts are estimates at **current Standard OpenAI API prices**, not Codex subscription charges, historical invoices, or OpenAI's internal infrastructure cost.
- Current Sol promotional pricing and per-request long-context multipliers are included. The published cache-write rate is applied separately when present in the logs.
- Unreleased or unidentified models use the user's chosen Sol proxy, labeled in the model breakdown. A missing request context size uses short-context rates and is disclosed.
- Tool fees, regional uplifts, special processing tiers, taxes, and plan discounts are not included.
- Work without an input/output token split remains in token totals; its unpriceable portion is flagged instead of invented.
- The project list and its total use one selected period (30 days by default). Project drawers also show total recorded project cost.
- The board, today, trailing 30 days, and month-to-date are fixed windows based on the collection date in the collector's timezone. Stale snapshots identify their latest day instead of calling it today.
- All project rows are available; the initial display limit is not the active-project count.
- Model usage shows token share and estimated cost share for the active range/workspace/helper filters. Project and day drawers show the same breakdown scoped to that work or day. Context tiers are combined for the headline and remain separate in expanded rate formulas; confirmed Sol usage and Sol-proxy estimates are never merged.
- Usage does not prove a business outcome shipped. Outcomes are human annotations, never inferred.

## Data and privacy

The collector reads only the session logs and thread-name index in:
- `~/.codex/sessions`
- `~/.codex/archived_sessions`
- `~/.codex/session_index.jsonl`

The private derived cache is `~/.codex/cache/usage-dashboard-index.json`.
Public snapshots contain only selected session metadata and aggregated usage buckets.
They exclude raw messages, prompts, tool arguments, cumulative fingerprints, and absolute workspace paths.
Work names are still potentially sensitive: review them before sharing outside the intended audience.

## Implementation

- `lib/telemetry.js`: ingestion, caching, inherited-history reconciliation, and safe snapshot export.
- `public/pricing.js`: one auditable rate table, alias/proxy policy, cache and context pricing.
- `public/analytics.js`: the shared server/browser transform. Project, model, day, and overall totals come from the same events.
- `public/model-usage.js`: presentation rollup of already-priced model context tiers; no repricing or token counting.
- `public/view.js`: pure presentation functions.
- `public/app.js`: filters, accessible drawer, heatmap interactions, and refresh state.
- `public/refresh-client.js`: safe fresh-data loading, timeouts, and no stale-data downgrade.
- Snapshot / response schema and collector counting version: **3**. Older, replay-inflated snapshots are intentionally rejected.

## Refresh

Page load fetches the newest published snapshot; it cannot read a remote visitor's local files.

The **Refresh** button probes the local collector on `127.0.0.1:3185`.
On KJ's Mac it forces a recount and loads that snapshot directly, without waiting for the hosting cache.
From GitHub it also requests publication. From Sites it refreshes this browser's view locally, explicitly distinguishing that from a shared-site update.
If the collector is unavailable, it checks the published snapshot and clearly says that no new logs were collected.
Failures keep the last good data. An older snapshot never replaces a newer count.

`npm start` starts/reuses the collector and redirects local port 3184 to the public dashboard.
`npm run helper:install` installs the existing macOS collector service.
Restart that service after changing collector source, so it does not retain old parsing code.
The existing weekday publishing schedule is retained; uncommitted source changes now stop scheduled publication rather than shipping a half-edited app.

## Develop and verify

```bash
npm test
npm run build:site
npm run verify:snapshot
```

No dependency install is needed. A build writes the private cache and generated snapshot; the local environment may request permission for the cache directory.

`npm run build:sites` produces the Sites Worker bundle using the same data and frontend.
Commit the tested source before `npm run publish:pages`. Sites publishing additionally requires saving the built version and approval for the existing shared access.

For an isolated local preview, run `node server.js` with an unused port rather than opening `public/index.html` as a file.

## Optional project outcomes

Edit `config/project-impact.json`. Its `projects` object is keyed by the root conversation ID.
Supported fields are `project_label`, `impact_label`, and `business_outcome`.
Only add outcomes you have checked. Missing annotations are harmless. The export copies this file into the published data directory.
