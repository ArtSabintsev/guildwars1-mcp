# Security

This MCP server is read-only. It should not log into ArenaNet, automate a game
client, manipulate accounts, mount virtual disks, extract proprietary archives,
download binary assets by default, or call private APIs.

## Local Inventory

Local inventory is disabled unless explicit roots are provided by `GW1_LOCAL_ROOTS`
or by a tool call. The scanner reports metadata only. It does not parse `Gw.dat`,
does not mount `.vmdk` files, does not follow symlinks outside configured roots,
and does not write scan results.

## Reporting

Use GitHub private vulnerability reporting when the repository is public. If that
is unavailable, open a minimal public issue asking for a private reporting channel.

Do not submit secrets, tokens, cookies, account data, proprietary game archives,
private Discord exports, or local scan outputs.
