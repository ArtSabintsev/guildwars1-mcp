# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.5] - 2026-07-12

### Fixed

- serialize refresh with release and harden the rebase-push step (e3bb197)

## [1.3.4] - 2026-07-12

### Changed

- remove cross-repo mirror references from comments (d43633c)

## [1.3.3] - 2026-07-12

### Changed

- refresh skill index from Guild Wars Wiki (rev 2729408) (f2a8738)

## [1.3.2] - 2026-07-12

### Fixed

- rebase before pushing refreshed skill index (4f2effc)

## [1.3.1] - 2026-07-12

### Fixed

- use policy-compliant User-Agent in skill-index builder (1019c5b)

## [1.3.0] - 2026-07-08

### Added

- `gw1_skill_index_provenance` tool: reports when the bundled skill index was
  extracted, which Guild Wars Wiki revision it reflects, per-category counts,
  and a content hash — so LLM consumers can judge how stale template
  decode/encode data is. The same provenance block is embedded in
  `src/skills.generated.ts` and surfaced through `gw1_sources`.
- Scheduled skill-index refresh (`.github/workflows/refresh-skill-index.yml`):
  weekly re-extraction of the bundled skill index from the wiki, gated on
  `npm run skills:check` (a content-hash comparison that ignores volatile
  provenance fields), validated by typecheck + tests before an auto-commit.
- Automatic semver releases: every substantive push to `main` (including
  scheduled data refreshes) is now versioned from conventional commits by
  `.github/workflows/release.yml` + `scripts/prepare-release.mjs`, which update
  this changelog, tag the release, and publish GitHub Release notes.
- Shared HTTP layer hardening (`src/http.ts`): one conservative retry on
  transient failures (network errors and HTTP 408/5xx; rate limits and client
  timeouts are deliberately not retried), in-flight
  coalescing of concurrent identical requests, and a bounded response cache.

### Fixed

- Cache freshness is now judged against each caller's TTL instead of the TTL of
  whichever caller fetched first, so fast-moving reads can never be pinned to
  stale data by an earlier long-TTL fetch of the same URL.
- MediaWiki API errors (rate limits, blocked clients, bad params) are surfaced
  as tool failures instead of silently reading as empty search/recent-changes
  results.
- `gw1_wiki_search` with `source: "both"` now returns results from the healthy
  wiki plus a `failedSources` list when one wiki is down, instead of failing
  the whole call.
- The skill-index builder (`scripts/build-skill-index.mjs`) gained request
  timeouts and retries on every fetch, a guard against MediaWiki error payloads
  (previously a `TypeError`), and no longer drops legitimate zero values
  (0-energy, 0-recharge skills) from the generated metadata.
- The User-Agent version is derived from `package.json` (was hardcoded to
  1.2.0), so it can no longer drift across releases — relevant because the
  Guild Wars Wiki 403-blocks non-compliant clients.

### Changed

- Freshness-critical reads (`gw1_wiki_recent_changes`, `gw1_game_updates`) use
  a 60-second cache TTL instead of the 5-minute default.

## [1.2.0] - 2026-06-28

### Added

- Full skill-template decoder: template codes now resolve to primary/secondary professions, attributes with points, and the eight skills by name (bundled Guild Wars Wiki skill index, ~3000 skills, regenerable via `npm run skills:build`).
- Bundled per-skill metadata (profession, attribute, elite, PvE-only, Kurzick/Luxon allegiance, PvE/PvP-split flag) derived from wiki categories.
- `gw1_template_encode` tool: construct an importable template code from professions, attributes, and skill names.
- Build-legality validator enforcing the in-game rules: at most one elite, at most three PvE-only skills, a single allegiance, and the 200 attribute-point budget; warns on profession mismatches and PvE/PvP-split skills.
- Per-skill numeric stats (energy, cast, recharge, adrenaline, upkeep) and an energy-management flag scraped from skill infoboxes; surfaced per skill in decoded output.
- Resource/viability analysis in the validator: total energy, sustained-drain ceiling, energy outlook (light / managed / adrenaline-based / needs-engine), longest recharge, and a resurrection-skill check — so builds are assessed for playability, not just legality.
- Per-skill wiki links in decoded output, so synergy explanations can be grounded in human-written sources.

## [1.1.0] - 2026-06-28

### Added

- Curated official and creator YouTube channel registry backed by public RSS feeds.
- YouTube video search tool for Guild Wars 1, Reforged, build, skill, and guide content.
- Cross-source content search tool spanning Guild Wars Wiki, PvXwiki, GW1 Builds, YouTube, and r/GuildWars.
- Scheduled source-smoke workflow for continuously checking live public source health.

## [1.0.0] - 2026-06-28

### Added

- Initial read-only MCP server for Guild Wars 1 public sources.
- Guild Wars Wiki and PvXwiki MediaWiki search, page, recent-change, and game-update tools.
- GW1 Builds public API search with author/handle fields omitted by default.
- r/GuildWars public Atom search with author/handle fields omitted by default.
- Guild Wars template-code analyzer for validation and source links.
- Opt-in local install and VMware Fusion inventory scanner with no default scan roots.
