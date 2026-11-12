# Project Economics Dashboard

**[Browse my Codex project index →](./PROJECTS.md)**


A dependency-free local dashboard for exploring Codex token activity, estimated API-equivalent cost, and project ROI scenarios. The Codex usage in the demo is synthetic. The separate GitHub calendar shows real contributions visible on [@kjmcawesome’s public profile](https://github.com/kjmcawesome). It contains no personal usage history, customer annotations, credentials, or production deployment bindings.

## Run the demo

Use Node.js 22 or newer. No package install or API key is needed.

```sh
npm start
```

Open http://localhost:3184. Startup generates three fictional sessions and serves the app locally. Demo mode does not read your Codex logs or sync to a remote account. The GitHub calendar reads publicly visible daily totals from GitHub without a token. It does not turn Codex usage into GitHub contributions. Change `PORT` if that port is occupied.

Select a project, enter hours saved and an hourly value or other benefit, and inspect modeled investment, net value, ROI, and break-even hours. Assumptions are saved in that browser. Clear the fields to reset them. Empty or incomplete inputs do not create a claimed return.

The period, workspace, helper toggle, model breakdowns, Codex activity board, and project/day details all use the same underlying records. Presentation view substitutes descriptive labels for screen sharing; it does not change data access or hosting permissions.

## Data definitions

- Total tokens are input plus output. Cached input is part of input; reasoning is part of output.
- Root tasks include linked helpers. Helper history inherited from a parent is deduplicated.
- API-equivalent cost is a model, not a subscription bill, historical invoice, or internal operating cost.
- Rates use published Standard pricing checked on November 12, 2026. The rate source is [OpenAI API pricing](https://developers.openai.com/api/docs/pricing.md). Cache-write estimates use the published 30-minute tier where available. For older models without a published cache-write tier, writes fall back to the input rate as an estimate. Older GPT-5.2-Codex records use its [published legacy rate](https://developers.openai.com/api/docs/models/gpt-5.2-codex.md); inclusion in the table does not imply current model availability. Other retention tiers, tools, regional uplifts, taxes, discounts, and processing speeds are not included.
- Unknown model identifiers use an explicitly labeled estimate. No internal model aliases or unpublished model rates are bundled.
- ROI uses the value assumptions entered by the viewer. It does not prove that a project shipped or saved the modeled time.

## Verification and static build

```sh
npm test -- --test-concurrency=1
npm run build:site
npm run verify:snapshot
```

`build:site` produces a demo with synthetic Codex usage and a verified public GitHub calendar when available, in the ignored `demo-dist` directory. Demo builds neither read nor overwrite personal snapshots under `public/data`. No deployment runs automatically. Legacy GitHub Pages publication is disabled.

## Collect your own data explicitly

The collector remains available for local use:

```sh
npm run collect:local
```

This explicit command reads your local `~/.codex/sessions`, archived sessions, and task-name index. It writes a private derived cache and an ignored local snapshot. It skips the synthetic seed and demo snapshot so fictional usage is never added to your own counts. It preserves previously collected sessions when logs are later unavailable. Collection timestamps distinguish fresh local records from retained history.

Task and workspace labels may be sensitive even though messages, prompts, tool arguments, and absolute paths are omitted. Review labels and the complete generated data before sharing. Keep personal snapshots and configuration out of commits.

## Optional hosted collector

The source includes a generic object-storage runtime and authenticated sync endpoint. Configure your own storage and hosting access policy; this repository includes no deployed service or hosting binding.

Set `USAGE_DASHBOARD_URL` to your HTTPS dashboard origin before starting the collector with `npm run collector:start`. Only that configured origin and loopback origins may call it. Cloud configuration is saved locally under the ignored `.cloud-sync` directory. The configuration accepts `url`, a sync `token` of at least 32 characters, and an optional `site_access_token` when the chosen host requires one. Supply configuration privately on standard input to `node scripts/configure-cloud-sync.js`.

A configured Mac can refresh just the public contribution calendar with `node lib/cloud-sync.js --github-only`. The hosted dashboard reads the last verified calendar when its own GitHub request is unavailable. The local demo does not enable cloud sync.

If an interrupted export leaves `.usage-export.lock`, stop all collector and build processes before clearing the lock. The exporter fails closed rather than deleting a lock another process might own.

## Implementation

- `public/roi.js`: scenario calculations and browser persistence.
- `public/analytics.js`: shared aggregation and filtering.
- `public/pricing.js`: public rate table and disclosed estimate policy.
- `lib/telemetry.js`: local log parsing and helper attribution.
- `lib/history.js`: historical retention without adding overlapping session counters.
- `lib/cloud-runtime.js`: authenticated, conditional cloud updates.
- `config/history-baseline.json`: three synthetic test/demo sessions.
