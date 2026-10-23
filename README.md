<img src="assets/DangoBums.png" width="96" height="96" alt="" align="right">

# DangoBums Sources

Trackers and content sources for the [Mana](https://github.com/Mana-iOS/mana-dev) app.

## Adding to Mana

1. Open Mana and go to **Discover**
2. Tap the package button, then **Plus**
3. Paste the repository URL:

   ```
   https://dangobums.github.io/mana-extensions/main
   ```

The page at <https://dangobums.github.io/mana-extensions/main> lists the extensions and their changelog.

## Extensions

|                                                              | Name    | Type    | Version | Rating |
| :----------------------------------------------------------: | ------- | ------- | ------- | ------ |
| <img src="assets/AniList.png" width="28" height="28" alt=""> | AniList | Tracker | 1.1.1   | Mixed  |
|  <img src="assets/Komga.png" width="28" height="28" alt="">  | Komga   | Source  | 1.0.1   | Mixed  |

See [CHANGELOG.md](CHANGELOG.md) for what changed.

## AniList setup

Sign in from the tracker's account screen in Mana — it uses the bundled AniList client
`53586`, whose redirect URL is `com.seyden.mana://oauth/anilist`. Nothing to configure.

To use your own client instead:

1. Open <https://anilist.co/settings/developer> and create a client.
2. Set its **Redirect URL** to exactly `com.seyden.mana://oauth/anilist`. AniList's implicit grant
   always sends you back to the client's registered redirect, and Mana only finishes sign-in on a
   `com.seyden.mana://` URL.
3. Paste the client's **ID** into the tracker's settings, then sign in. The client secret is not
   used and must never go into the extension.

To sign in without the in-app flow, use AniList's PIN flow instead:

1. Create a client whose Redirect URL is `https://anilist.co/api/v2/oauth/pin`.
2. In a browser, open `https://anilist.co/api/v2/oauth/authorize?client_id=<ID>&response_type=token`.
3. Approve the client, copy the token AniList shows, and paste it into **Access Token** in the tracker's settings.

Tokens last a year. When one expires or is revoked, the tracker signs out and asks you to sign in again.

## Komga setup

Komga is a source for your own [Komga](https://komga.org) server. In Mana, open the source's
settings and enter:

1. **Server Address** — the address you open Komga at, e.g. `http://192.168.1.10:25600`
   (a sub-path such as `https://host/komga` works too).
2. One way to sign in:
   - **API key** (recommended) — create one in Komga under *Account Settings → API Keys*.
   - **Email and password** — in the settings, or from Mana's sign-in screen for the source.

   When both are set, the API key is used. The settings footer shows whether the server is
   reachable and which account is connected.

Add the source more than once to use several servers. Reading in Mana marks books read in
Komga and keeps the page you stopped at; progress made in Komga's web reader or other apps
shows up in Mana. Series whose metadata links to AniList, MangaUpdates, Kitsu, MyAnimeList or
MangaDex are linked to those trackers automatically.

The Komga source follows the behaviour of the [Keiyoushi Komga extension](https://github.com/keiyoushi/extensions-source/tree/main/src/all/komga)
(Apache-2.0) for Mihon, reimplemented in TypeScript for Mana.

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+ (CI uses it; `npm` works locally too)
- Node.js 18+

```bash
bun install
```

### Layout

```
src/<Name>/      one extension per directory: main.ts (class + parsers), model.ts (constants, API types)
lib/             shared code, inlined into every bundle at build time
  source.ts        BaseSource: lazy network client, home sections, "view more" listings
  client.ts        network client, rate limit, Cloudflare and JSON/GraphQL error handling
  graphql.ts       one GraphQL POST with typed data and readable errors
  tracker.ts       TokenStore (OAuth token + expiry in SecureStore), status and id helpers
  forms/           search form, filter reading, preferences, query strings
  html.ts text.ts  cheerio helpers for scraping sources
templates/       starting points: source/ (a site with chapters), tracker/ (a ContentTracker)
scripts/         scaffold, contract test, harness, Pages generator
```

### Creating a new extension

```bash
bun run new-source <Name> --id <id> --url https://site            # content source
bun run new-source <Name> --id <id> --url https://site --tracker  # tracker
```

Copies the template, rewrites the class and `info` block, and seeds the CHANGELOG entry,
README row and probe file. Then drop an icon at `assets/<Name>.png`.

Claude Code users: the `mana-extension` skill in `.claude/skills/` walks the whole flow and
documents the `@mana-app/types` surface, the intent bitmask and the runtime's constraints;
`references/tracker.md` covers trackers.

### Checks

```bash
bun run lint
bun run format
bun run typecheck
bun run build
```

`typecheck` matters: the build uses esbuild, which strips types without checking them, so an
extension written against a removed API compiles cleanly and then does nothing in the app.

Confirm what the app will see:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.environment,s.intents)"
```

A tracker must report `environment: tracker`.

### Verifying against the live service

```bash
bun run verify <Name>    # or --all
```

Loads the built `.mana` bundle with host shims and drives it through the methods the app calls,
asserting the shape of each result. For trackers it also runs the read-only tracker calls; to
include the signed-in ones, export the token named by `tokenEnv` in `scripts/probes/<Name>.json`:

```bash
ANILIST_TOKEN=<token> bun run verify AniList
```

The contract test never calls anything that writes to the account.
