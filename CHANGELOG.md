# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
