# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Komga (current: v1.0.0)

### 2026-10-19

- Initial implementation: a source for your own Komga server (tested against
  Komga 1.28.1), with any number of servers side by side.
- Sign in with an API key, or an email and password from the settings or
  Mana's sign-in screen. Credentials are kept in the keychain and only ever
  sent to the configured server; the settings show the connection status.
- Home page with Keep Reading, Recently Added and Recently Updated series and
  Latest Books; each Komga library is a library link; default libraries can be
  chosen in the settings.
- Search across series with library, read status, series status, publisher,
  tag and genre filters (tags and genres can be excluded) and five sort orders.
- Series pages with summary, alternate titles, genres, tags, staff and links;
  series linked from their metadata to AniList, MangaUpdates, Kitsu,
  MyAnimeList or MangaDex.
- Books are chapters in number order, titles without the repeated series
  name; only books Komga can show as images (comics, PDFs, image EPUBs).
  Covers and pages load through the signed-in client.
- Reading progress syncs both ways: finishing a book marks it read in Komga,
  marking chapters read or unread updates Komga, the current page is saved as
  you read, and Mana picks up what was read elsewhere.


## AniList (current: v1.1.1)

### 2026-10-23 — Settings fixes

- Removed the **Troubleshooting → Show Sign-in Request** setting. Left on, it
  sent every sign-in to an echo page instead of AniList; a value saved by an
  older version is now ignored.
- **Show Adult Titles** now adds and removes AniList's adult tags in the search
  filters. The tag list was cached with the setting as it was the first time.
- An expired or revoked token no longer makes browsing fail: the tracker signs
  out and repeats the request without it.
- The **Access Token** field says whether you are signed in, and only a whole
  token replaces the saved one, so a half-typed or half-pasted value cannot
  sign you out.

### 2026-10-19 — @mana-app/types 0.1.1

- Rebuilt with `@mana-app/types` 0.1.1 and `@mana-app/dev` 0.2.0. Requests go
  through the new `HttpClient`; GraphQL calls send `Body.json` and read the
  reply asynchronously, and API errors are still reported with AniList's own
  message.
- A rate-limited request (HTTP 429) is now retried after AniList's
  `Retry-After` instead of failing. The new client only retries GET by default,
  and every AniList call is a POST.
- Sign-in returns the new `OAuthURL` type; the request itself is unchanged.
- Characters, staff, relations and recommendations no longer offer "view
  more": Mana does not call the method that would load the rest yet.

### 2026-10-12 — Sign-in works

- **Fixes AniList sign-in failing with "unsupported grant type".** The request
  sent `redirect_uri`, which AniList's implicit grant does not take; it now
  sends only `client_id` and `response_type` and AniList redirects to the
  client's registered URL. Mana still closes the sign-in sheet on the
  `com.seyden.mana` callback scheme. Confirmed working in Mana.

### 2026-10-12 — Sign-in diagnostics

- New **Troubleshooting → Show Sign-in Request** setting. While it is on,
  signing in opens an echo page instead of AniList, showing the exact URL and
  parameters Mana opened, to pin down why AniList answers "unsupported grant
  type".

### 2026-10-12 — Sign-in fix

- AniList sign-in failed with "unsupported grant type", meaning AniList got
  no usable `response_type=token`/`client_id`. The parameters were only in the
  request's `params`; they are now in the authorize URL itself as well, in
  case Mana does not forward `params`. This did not fix it on its own.

### 2026-10-12

- Initial implementation: an AniList `ContentTracker` for manga, manhwa,
  manhua and light novels.
- Sign-in through AniList's OAuth implicit grant in Mana's web authentication
  sheet, using the bundled client `53586` (redirect URL
  `com.seyden.mana://oauth/anilist`). Your own client ID can be set in
  settings, or an access token pasted there instead.
- Reading progress syncs as chapters are read: the first chapter moves a title
  to Reading, the last one marks it Completed (counting a reread when it was
  being reread), and empty start/finish dates are filled in. Both behaviours
  can be turned off.
- Entry editor covering status, score in the account's own scoring format,
  chapter and volume progress, rereads, dates, notes, custom lists and privacy.
- Discover page with five sections loaded in a single request, your AniList
  lists in the library, search with genre/tag include-exclude, format, status,
  country, year and "on my list" filters, eight sort orders, and
  `anilist.co/manga/<id>` deep links.
- Search filters are checked before a search runs: a tag both included and
  excluded, a year out of range, or "on my list" while signed out is reported
  on the field instead of returning nothing.
- Result tiles show format, status, chapters, volumes, score and year, plus a
  badge with your list status when the title is already on your AniList.
- Title pages carry characters, staff, relations, recommendations, external
  links and the AniList/MyAnimeList ids for linking sources. Characters, staff,
  relations and recommendations show "view more" when there are more than ten.
- Manhwa and manhua recommend the webtoon reader; manga recommend paged
  right-to-left.
