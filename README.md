# Guild Wars 1 MCP

Read-only Model Context Protocol server for Guild Wars 1 public sources and opt-in
local install inventory.

## Sources

- Guild Wars Wiki: `https://wiki.guildwars.com/api.php`
- PvXwiki: `https://gwpvx.fandom.com/api.php`
- GW1 Builds: `https://gw1builds.com/api/builds`
- YouTube public RSS feeds for official and creator channels
- r/GuildWars public Atom search
- Local Guild Wars install or VMware Fusion bundle metadata, only when explicit roots are provided

## Install

```json
{
  "mcpServers": {
    "guildwars1": {
      "command": "npx",
      "args": ["-y", "github:<owner>/guildwars1-mcp"]
    }
  }
}
```

From a checkout:

```bash
npm install
npm run build
node dist/index.js
```

## Tools

- `gw1_sources` - list configured public and local source surfaces.
- `gw1_wiki_search` - search Guild Wars Wiki, PvXwiki, or both.
- `gw1_wiki_page` - fetch a wiki page with extracted text, links, categories, and revision metadata.
- `gw1_wiki_recent_changes` - read recent public changes from a wiki source.
- `gw1_game_updates` - parse recent Guild Wars game-update sections from Guild Wars Wiki.
- `gw1_builds_search` - search GW1 Builds public API and/or PvXwiki.
- `gw1_template_code_analyze` - validate and classify Guild Wars template/build codes.
- `gw1_subreddit_search` - search r/GuildWars public Atom results.
- `gw1_youtube_sources` - list curated official and creator YouTube feeds.
- `gw1_youtube_videos` - fetch recent public YouTube videos from curated feeds.
- `gw1_content_search` - search across wiki, PvXwiki, GW1 Builds, YouTube, and r/GuildWars.
- `gw1_local_inventory` - scan explicit local roots for Guild Wars or VMware Fusion metadata.

## Resources

- `gw1://sources` - public source registry.
- `gw1://wiki-sources` - MediaWiki source registry.
- `gw1://youtube-sources` - official and creator YouTube source registry.

## Update Pipeline

Most content is fetched fresh at tool-call time from public APIs and feeds. The
repo also includes a scheduled `Source Smoke` GitHub Actions workflow that runs
live checks against the public source surfaces. It does not commit scraped data
or publish artifacts; it catches dead feeds, API shape changes, and source
breakage so the curated registry can be updated intentionally.

## Local Inventory

Local inventory is opt-in. The server never scans default locations, home
directories, VMware folders, or game installs by itself.

Use explicit roots:

```bash
GW1_LOCAL_ROOTS="/path/to/Guild Wars:/path/to/Some VM.vmwarevm" guildwars1-mcp
```

Or pass roots to the `gw1_local_inventory` tool.

The scanner can detect:

- `Gw.exe`
- `Gw.dat` metadata only
- `Templates` folders and plausible template codes in `.txt` files
- `.vmwarevm`, `.vmx`, and `.vmdk` metadata

It does not mount virtual disks, parse `Gw.dat`, follow symlink escapes, or write
scan output. Paths are redacted by default unless a caller explicitly opts out.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run smoke:sources
```

## Notes

This project is not affiliated with ArenaNet, NCSoft, Guild Wars Wiki, PvXwiki,
GW1 Builds, Reddit, or VMware. It fetches public, read-only data and returns
source URLs so agents can attribute claims back to the original source.
