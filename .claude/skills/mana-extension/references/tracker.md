# Trackers (`ContentTracker`)

Verified against `@mana-app/types@0.1.1` and the runtime embedded in `@mana-app/dev@0.2.0`.
`src/AniList/` is the reference implementation; `templates/tracker/` is the starting point
(`bun run new-source <Name> --id <id> --url <https://site> --tracker`).

## How the app decides it is a tracker

`mana-dev` writes `environment` into `dist/sources.json` next to the intent bitmask. It is
`"tracker"` only when the instance has **all six** of:

```
getContent  search  didUpdateLastReadChapter  didUpdateStatus  getEntryForm  didSubmitEntryForm
```

Anything less and the bundle ships as a plain `"source"` — silently, the build stays green.
Check after every build:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.environment,s.intents)"
```

`getTrackEntry`, `getStatusOptions` and `removeTracking` are not part of the detection but the
interface requires them, and the app calls them; implement them anyway.

## The interface

```ts
interface ContentTracker extends ContentSource {      // ContentSource = getContent + search
  readonly trackerConfig?: { linkKeys?: string[]; owningLinks?: string[] };
  getTrackEntry(id): Promise<TrackEntry | null>;      // null = not on the user's list
  getStatusOptions(): Promise<TrackerStatusOption[]>; // { id, title, isDefault? }
  removeTracking(id): Promise<void>;
  didUpdateLastReadChapter(id, { chapter?, volume? }): Promise<void>;
  didUpdateStatus(id, status: string): Promise<void>; // must create the entry if missing
  getEntryForm(id): Promise<Form>;
  didSubmitEntryForm(id, form): Promise<void>;
}
```

- **Statuses are plain strings** you define in `getStatusOptions`. The 0.0.24 `TrackStatus`
  enum is gone. Use the service's own ids (AniList: `CURRENT`, `PLANNING`, …) so no mapping
  layer is needed, and mark one `isDefault`. Reject unknown ids in `didUpdateStatus`.
- **`TrackEntry`** is `{ status, progress: { lastReadChapter, maxAvailableChapter?, lastReadVolume? } }`.
  Put it on `Highlight.entry` in list/search results too — the app only reads that field on
  tracker pages, and it is what shows the user's progress on each tile.
- **`trackerConfig.linkKeys`** are the keys content sources use in `Content.trackerInfo`
  (`{ anilist: "30013", mal: "13" }`) to link their titles to this tracker. Without it the app
  falls back to `info.id`. A tracker's own `getContent` should fill `trackerInfo` with every id
  it knows, so sources and other trackers can cross-link.
- **`didUpdateLastReadChapter`** is called when the user reads past the tracked chapter. It is
  where the "automatic" part of tracking lives: never lower progress, clamp to the known total,
  move planned/paused/dropped titles to reading, complete on the last chapter. Keep it a pure
  function of `(remote entry, progress, preferences)` below the class so it can be tested.

## The entry form

`getEntryForm` returns a `Form` built from `UIListSection` + `UIPicker`/`UIStepper`/
`UIDatePicker`/`UITextField`/`UIToggle`/`UIMultiPicker`. No `didChange` handlers — the app
collects the edits and calls `didSubmitEntryForm` once. What arrives:

- **Only changed keys.** An absent key means "leave it". Build the update from the keys that
  are present (`Object.prototype.hasOwnProperty.call(form, key)`), never from defaults.
- **`null` means cleared** (an `optional` field the user emptied). Translate it into whatever
  the service uses to clear — AniList wants `{ year: null, month: null, day: null }` for a date
  and `""` for notes.
- **Dates are ISO-8601 strings.** A date picked at local midnight arrives as the previous day
  in UTC for users east of Greenwich; read it back with the local `getFullYear/getMonth/getDate`,
  and build form values with `new Date(y, m - 1, d)`, so the two directions agree.
- **Picker values may be a string id or an `Option`.** Read them through `FilterReader`
  (`new FilterReader({ filters: form })`), as for search filters.
- Submitting a form for an untracked title should create the entry: add the default status
  when the form did not set one.

Score fields should follow the account's own scoring format (AniList: 100-point, 10-point,
decimal, 5 stars, 3 smileys) and convert to one raw scale on submit.

## Authentication

Trackers are almost always OAuth. The intent needs `getAuthenticatedUser` + `handleUserSignOut`
plus `getOAuthRequestURL` + `handleOAuthCallback`:

```ts
async getOAuthRequestURL(): Promise<OAuthURL> {          // lib/tracker.ts
  return oauthRequest(AUTHORIZE_URL, { client_id, response_type: "token" }, REDIRECT_URL);
  // → { url, params: { client_id, response_type, redirect_uri }, callbackScheme: "com.seyden.mana" }
}
async handleOAuthCallback(response: string) {     // the full redirect URL
  const params = parseParams(response);           // lib/forms/query.ts: query + fragment
  await this.tokens.save(params["access_token"], Number(params["expires_in"]));
}
```

- **Mana's OAuth callback is `com.seyden.mana://oauth/<anything>`.** Sign-in runs in an
  `ASWebAuthenticationSession`, which finishes only when the provider redirects to the request's
  `callbackScheme`. Return `params.redirect_uri` *and* `callbackScheme` — `oauthRequest` derives
  the scheme from the redirect so they cannot disagree. **Put the whole query in `url` too** — it
  is not known which of the two the app builds the page from, so `oauthRequest` writes both.
  Pass `{ sendRedirectUri: false }` for providers whose implicit grant only redirects to the
  client's registered URL; `callbackScheme` is still sent and is all Mana needs. **Confirmed for
  AniList:** with `redirect_uri` in the request, sign-in in Mana failed with
  `unsupported_grant_type`; without it (`?client_id=…&response_type=token`, as in AniList's docs
  and Komikku) it works and Mana closes the sheet on `com.seyden.mana://oauth/anilist`. If a new
  tracker's sign-in fails, temporarily point the authorize URL at an echo service
  (`https://postman-echo.com/get`) to see the exact URL Mana opens — and never ship that as a
  user setting: AniList 1.0.2–1.1.0 had one, and a user who left it on could not sign in. Since 0.1.0 the return type is `OAuthURL` (`BasicURL` plus a required
  `callbackScheme`: the scheme only, no `://`), so leaving it out fails typecheck instead of
  leaving the sheet open. The full redirect URL then reaches `handleOAuthCallback`. Register one path
  per tracker on the service's client (AniList uses `com.seyden.mana://oauth/anilist`) and put it
  in the extension's README and settings footer, because users register their own clients.
- A pasted-token `UITextField` gets every edit through `didChange`. Save only a value that is a
  whole token (AniList: a JWT, three base64url segments), or a half-typed one replaces a working
  token. Show whether one is saved in the placeholder — the field's value stays empty.
- When the API rejects the token, sign out and repeat read-only requests without it, so public
  browsing keeps working; only calls that need an account should surface "sign in again".
- **Show the account and a sign-out in settings.** Store the account name with
  `tokens.setAccount(name)` whenever the viewer is fetched (sign-in, pasted token), and in
  `getPreferenceMenu` show it, `maskToken(token)` with `tokens.expiresAt()`, and a destructive
  `UIButton` whose `action` calls `handleUserSignOut()` — no request, since the menu is rebuilt
  on every edit. The screen does not redraw after the button; say so in the footer.
  `jwtExpiresIn(token)` reads a pasted JWT's expiry.
- Keep tokens in `SecureStore` through `TokenStore` (`lib/tracker.ts`). It stores the expiry as
  a native number, clears an expired token on read, and wraps every typed read — a `SecureStore`
  accessor throws on a type mismatch just like `ObjectStore`.
- When the API rejects the token (`Invalid token`, 401), clear it and throw an error telling the
  user to sign in again; do not keep sending it.
- A client id registered by someone else's app only redirects to *their* callback. Make the
  client id a preference, and offer a manual token field for services with a copy-paste flow
  (AniList's `https://anilist.co/api/v2/oauth/pin` redirect).
- `getAuthenticatedUser` must return `null`, not throw, when there is no token or it was just
  found invalid. Cache the viewer per token; many calls need its id or settings.
- Gate everything that needs an account (`getTrackEntry` → `null`, writes → a clear
  "Sign in" error, `getLibraryPageLinks` → `[]`).

## Library and discover pages

- `getLibraryPageLinks` returns one `PageLinkLabel` per list status, each linking to
  `{ request: { page: 1, listId: "status:<ID>" } }`. Route that prefix in `search` after
  `this.listResults(request)` and return the user's list with `Highlight.entry` filled.
- Home sections come from `BaseSource.sections()` exactly as for content sources. Use one page
  size for every page of a listing, or "view more" skips the items between the two sizes.
- **Rate limits on POST APIs.** `HttpClient` retries only GET/HEAD by default, and a GraphQL API
  answers everything with POST. Pass `retry: retryRateLimited()` (`lib/tracker.ts`) in
  `clientOptions()` so a 429 is retried after the server's `Retry-After`.

## Home page and title pages

- **Prefill home sections.** A `PageSection` returned with `items` is treated as resolved and
  the app skips `resolvePageSection` for it. AniList overrides `getSectionsForPage` to fetch
  every section in one aliased query (`homeQuery` in `src/AniList/queries.ts`) and falls back to
  the plain sections if that request fails, so the app resolves them one by one instead. Keep
  `resolvePageSection` working: "view more" and the fallback both use it.
- **No "view more" on title pages yet.** The app stores only ten items per additional-info
  section, and as of 0.1.1 `getAdditionalInfoSectionItems` is documented as "Currently unused:
  the app does not call this method". Send at most ten items with `hasMore: false`; a `true`
  would offer a "view more" that cannot load anything.
- **`Highlight.info: Pair[]`** shows key/value details on a tile, and **`badge: { text }`** a short
  label — AniList uses it for the user's list status in browse results, never on the user's own
  list pages where every tile has the same status.
- **`validateSearchForm(form)`** runs before a search is applied. Return
  `{ valid: false, message, fieldErrors: { [fieldId]: "..." } }` for combinations the API would
  silently answer with nothing. Read `form.filters` through `FilterReader`.

## GraphQL services

`lib/graphql.ts` posts one operation through the source's client:

```ts
await graphql<T>(this.http, API_URL, QUERY, variables, token);
```

It sends `Body.json({ query, variables })` (unset `undefined` variables are dropped) and reads the
reply with `response.json()`. Build the client with `json: true`: a JSON API's 403 is then
treated as an API error rather than Cloudflare (only a challenge-page body counts), and
`errors[].message` from a 4xx body becomes the thrown error's message — `HttpClient` itself
resolves on error statuses, so without `json: true` nothing would throw. Use `@include(if:)` to
skip user-specific fields when signed out. In inline arguments, GraphQL enums (`sort`, `status`) go in bare, but AniList's
`CountryCode` is a string scalar and must be quoted.

## Verifying

`bun run verify <Name>` detects a tracker and adds `getStatusOptions`, `getOAuthRequestURL`
(must carry `callbackScheme`, a `redirect_uri` under that scheme if any, and every param in the
URL too), a signed-out
`getTrackEntry` (must be `null`) and `handleURL` (probe `url`). With a token in the env var the
probe's `tokenEnv` names, it also runs `getAuthenticatedUser`, `getTrackEntry`, `getEntryForm`
and the first library list. It never calls a method that writes to the account — test the write
paths by stubbing the instance's request method (see the pure `progressUpdate`/`submittedUpdate`
helpers in `src/AniList/main.ts`).
