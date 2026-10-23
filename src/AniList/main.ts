import {
  AdditionalInfoType,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  UIDatePicker,
  UIListSection,
  UIMultiPicker,
  UIPicker,
  UIButton,
  UIStepper,
  UITextField,
  UIToggle,
  additionalInfo,
  type AdditionalInfoSection,
  type CharacterItem,
  type Content,
  type ContentTracker,
  type DeepLinkContext,
  type FilterPrimitives,
  type Form,
  type Highlight,
  type OAuthAuthenticatable,
  type OAuthURL,
  type Option,
  type PageLink,
  type PageLinkLabel,
  type PageLinkProvider,
  type PageSection,
  type PagedSearchResult,
  type Pair,
  type SearchForm,
  type SearchFormSubmission,
  type SearchFormValidationResult,
  type SearchRequest,
  type SimpleHighlight,
  type SortOption,
  type SourceConfig,
  type SourceContext,
  type SourceInfo,
  type SourcePreferenceProvider,
  type StaffItem,
  type Tag,
  type TrackEntry,
  type TrackProgressUpdate,
  type TrackerConfig,
  type TrackerStatusOption,
  type UIListElement,
  type User,
} from "@mana-app/types";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  parseParams,
  resolveSortId,
  type PreferenceSection,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import { graphql, type GraphQLVariables } from "../../lib/graphql.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  TokenStore,
  defaultStatus,
  isKnownStatus,
  numericId,
  oauthRequest,
  plainText,
  retryRateLimited,
  jwtExpiresIn,
  maskToken,
} from "../../lib/tracker.ts";
import {
  ADULT_GENRES,
  API_URL,
  AUTHORIZE_URL,
  CLIENT_ID,
  DETAIL_ITEMS,
  DEVELOPER_URL,
  EntryField,
  FORMAT_OPTIONS,
  FilterID,
  GENRES,
  HOME_SECTIONS,
  InfoSectionID,
  LIST_STATUS_PREFIX,
  ListStatus,
  MAL_URL,
  MEDIA_STATUS_OPTIONS,
  MIN_YEAR,
  PAGE_SIZE,
  PIN_REDIRECT_URL,
  REDIRECT_URL,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SEARCH_FIELDS,
  SIGNED_IN_FIELDS,
  SITE_URL,
  SMILEY_SCORES,
  SORT_OPTIONS,
  STAR_SCORES,
  STATUS_OPTIONS,
  ScoreFormat,
  SortID,
  TAG_PREFIX,
  TITLE_LANGUAGE_OPTIONS,
  TitleLanguage,
  type FuzzyDate,
  type HomeResponse,
  type MediaConnections,
  type MediaDetail,
  type MediaDetailResponse,
  type MediaEntryResponse,
  type MediaListEntry,
  type MediaListPageResponse,
  type MediaPageResponse,
  type MediaSummary,
  type MediaTitle,
  type PersonConnection,
  type PersonEdge,
  type SaveEntryVariables,
  type TagCollectionResponse,
  type Viewer,
  type ViewerResponse,
} from "./model.ts";
import {
  DELETE_ENTRY_MUTATION,
  ENTRY_QUERY,
  MEDIA_LIST_QUERY,
  MEDIA_QUERY,
  MEDIA_SUMMARY_QUERY,
  SAVE_ENTRY_MUTATION,
  SEARCH_QUERY,
  TAG_COLLECTION_QUERY,
  VIEWER_QUERY,
  homeQuery,
} from "./queries.ts";

const info: SourceInfo = {
  id: "anilist",
  name: "AniList",
  version: "1.1.4",
  description: "Track manga, manhwa and light novels on AniList",
  website: SITE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "AniList.png",
  developers: [{ name: "dangobums", github: "https://github.com/dangobums" }],
};

const config: SourceConfig = {
  disableUpdateChecks: true,
  owningLinks: ["anilist.co"],
};

const trackerConfig: TrackerConfig = {
  linkKeys: ["anilist", "al"],
  owningLinks: ["anilist.co"],
};

type Display = { titleLanguage: string; allowAdult: boolean };

type EntryMedia = MediaEntryResponse["Media"];

type EntryUpdate = Omit<SaveEntryVariables, "mediaId">;

type TrackingOptions = { autoComplete: boolean; autoDates: boolean };

class AniListTracker
  extends BaseSource
  implements ContentTracker, OAuthAuthenticatable, PageLinkProvider, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;
  readonly trackerConfig = trackerConfig;

  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);
  private readonly tokens = new TokenStore(info.id);
  private viewerCache: { token: string; viewer: Viewer } | undefined;
  private tagCache: { option: Option; isAdult: boolean }[] | undefined;

  protected clientOptions(): ClientOptions {
    return {
      baseUrl: SITE_URL,
      json: true,
      requests: 1,
      intervalMs: 1_000,
      retry: retryRateLimited(),
    };
  }

  protected sections(): SectionSpec[] {
    return HOME_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.style === undefined ? {} : { style: section.style }),
      load: (page: number) =>
        this.browse({ sort: section.sort, status: section.status, country: section.country }, page),
    }));
  }

  override async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
    const sections = await super.getSectionsForPage(link);
    try {
      const display = await this.display(link.context);
      const pages = await this.query<HomeResponse>(homeQuery(HOME_SECTIONS), {
        perPage: PAGE_SIZE,
        isAdult: display.allowAdult ? undefined : false,
        withEntry: (await this.tokens.get()) !== null,
      });
      return sections.map((section) => {
        const alias = HOME_SECTIONS.find((home) => home.id === section.id)?.alias ?? "";
        const media = pages[alias]?.media;
        return media
          ? { ...section, items: media.map((item) => toHighlight(item, display)) }
          : section;
      });
    } catch {
      return sections;
    }
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Account",
        footer:
          `Sign in works without a client ID. To use your own AniList client instead, create one at ` +
          `${DEVELOPER_URL} with the redirect URL ${REDIRECT_URL} and paste its ID here. To sign in ` +
          `outside the app, give a client the redirect URL ${PIN_REDIRECT_URL}, open ` +
          `${AUTHORIZE_URL}?client_id=<ID>&response_type=token in a browser and paste the token below.`,
        fields: [
          {
            type: "text",
            key: PreferenceID.ClientId,
            title: "Client ID",
            placeholder: `Client ID (leave empty to use ${CLIENT_ID})`,
          },
        ],
      },
      {
        header: "Content",
        fields: [
          {
            type: "select",
            key: PreferenceID.TitleLanguage,
            title: "Title Language",
            options: TITLE_LANGUAGE_OPTIONS,
          },
          { type: "toggle", key: PreferenceID.ShowAdult, title: "Show Adult Titles" },
        ],
      },
      {
        header: "Tracking",
        footer:
          "Reading the last chapter marks a title completed; starting or finishing one fills in the matching date when it is empty.",
        fields: [
          {
            type: "toggle",
            key: PreferenceID.AutoComplete,
            title: "Auto-complete Finished Titles",
          },
          { type: "toggle", key: PreferenceID.AutoDates, title: "Set Start and Finish Dates" },
        ],
      },
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    const form = await buildPreferenceMenu(this.preferences, this.preferenceSections());
    const account = form.sections[0];
    if (account && "children" in account) {
      const token = await this.tokens.get();
      if (token) {
        const name = (await this.tokens.account()) ?? "your AniList account";
        account.children.unshift(...(await this.signedInFields(token, name)));
        account.footer =
          `Signed in as ${name}. Signing out takes effect at once, but Mana does not redraw this ` +
          "screen: close Settings and open it again to see it. " +
          (account.footer ?? "");
      }
      account.children.push(this.tokenField(token !== null));
    }
    return form;
  }

  async getSearchForm(): Promise<SearchForm> {
    const display = await this.display();
    const signedIn = (await this.tokens.get()) !== null;
    return buildSearchForm({
      header: "Filters",
      fields: signedIn ? [...SEARCH_FIELDS, ...SIGNED_IN_FIELDS] : SEARCH_FIELDS,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Tags,
        title: "Genres & Tags",
        options: [
          ...genreOptions(display.allowAdult),
          ...(await this.tagOptions(display.allowAdult)),
        ],
      }),
      tagsHeader: "Genres & Tags",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    if (request.listId?.startsWith(LIST_STATUS_PREFIX)) {
      return this.userList(request.listId.slice(LIST_STATUS_PREFIX.length), pageOf(request));
    }

    const filters = new FilterReader(request);
    const tags = filters.excludable(FilterID.Tags);
    const query = request.query?.trim() ?? "";
    const year = filters.number(FilterID.Year);
    const hasYear = Number.isFinite(year) && year > 0;

    return this.browse(
      {
        search: query || undefined,
        sort: [sortKey(request, query)],
        format: filters.option(FilterID.Format) || undefined,
        status: filters.option(FilterID.Status) || undefined,
        country: filters.option(FilterID.Country) || undefined,
        genreIn: nonEmpty(genresOf(tags.included)),
        genreNotIn: nonEmpty(genresOf(tags.excluded)),
        tagIn: nonEmpty(tagsOf(tags.included)),
        tagNotIn: nonEmpty(tagsOf(tags.excluded)),
        startAfter: hasYear ? Math.trunc(year) * 10000 : undefined,
        startBefore: hasYear ? (Math.trunc(year) + 1) * 10000 : undefined,
        onList: filters.toggle(FilterID.OnList) ? true : undefined,
      },
      pageOf(request),
      request.context,
    );
  }

  async getContent(contentId: string, context?: SourceContext): Promise<Content> {
    const display = await this.display(context);
    const { Media } = await this.query<MediaDetailResponse>(MEDIA_QUERY, {
      id: numericId(contentId, "AniList id"),
      withEntry: false,
      items: DETAIL_ITEMS,
    });
    return parseContent(Media, display);
  }

  async validateSearchForm(form: SearchFormSubmission): Promise<SearchFormValidationResult> {
    const filters = new FilterReader(form);
    const fieldErrors: Record<string, string> = {};

    const tags = filters.excludable(FilterID.Tags);
    const conflicting = tags.included.filter((id) => tags.excluded.includes(id));
    if (conflicting.length > 0) {
      const names = conflicting.map((id) => id.replace(TAG_PREFIX, "")).join(", ");
      fieldErrors[FilterID.Tags] = `${names} cannot be both included and excluded.`;
    }

    const year = filters.number(FilterID.Year);
    const maxYear = new Date().getFullYear() + 2;
    if (Number.isFinite(year) && year > 0 && (year < MIN_YEAR || year > maxYear)) {
      fieldErrors[FilterID.Year] = `Pick a year between ${MIN_YEAR} and ${maxYear}.`;
    }

    if (filters.toggle(FilterID.OnList) && (await this.tokens.get()) === null) {
      fieldErrors[FilterID.OnList] = "Sign in to AniList to filter by your list.";
    }

    const messages = Object.values(fieldErrors);
    if (messages.length === 0) return { valid: true };
    return { valid: false, message: messages.join(" "), fieldErrors };
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const id = /anilist\.co\/manga\/(\d+)/i.exec(url)?.[1];
    if (!id) return null;
    const display = await this.display();
    const { Media } = await this.query<{ Media: MediaSummary }>(MEDIA_SUMMARY_QUERY, {
      id: Number(id),
      withEntry: (await this.tokens.get()) !== null,
    });
    return { content: toHighlight(Media, display) };
  }

  async getLibraryPageLinks(): Promise<PageLinkLabel[]> {
    if ((await this.tokens.get()) === null) return [];
    return STATUS_OPTIONS.map((option) => ({
      title: option.title,
      link: { request: { page: 1, listId: `${LIST_STATUS_PREFIX}${option.id}` } },
    }));
  }

  async getStatusOptions(): Promise<TrackerStatusOption[]> {
    return STATUS_OPTIONS;
  }

  async getTrackEntry(id: string): Promise<TrackEntry | null> {
    if ((await this.tokens.get()) === null) return null;
    const media = await this.entryOf(id);
    return media.mediaListEntry ? trackEntry(media.mediaListEntry, media.chapters) : null;
  }

  async removeTracking(id: string): Promise<void> {
    await this.requireToken();
    const entry = (await this.entryOf(id)).mediaListEntry;
    if (!entry) return;
    await this.query(DELETE_ENTRY_MUTATION, { id: entry.id });
  }

  async didUpdateLastReadChapter(id: string, progress: TrackProgressUpdate): Promise<void> {
    await this.requireToken();
    const media = await this.entryOf(id);
    const update = progressUpdate(media, progress, await this.trackingOptions());
    if (update) await this.save(media.id, update);
  }

  async didUpdateStatus(id: string, status: string): Promise<void> {
    await this.requireToken();
    if (!isKnownStatus(STATUS_OPTIONS, status)) {
      throw new Error(`"${status}" is not an AniList list status`);
    }
    const media = await this.entryOf(id);
    await this.save(media.id, statusUpdate(media, status, await this.trackingOptions()));
  }

  async getEntryForm(id: string): Promise<Form> {
    await this.requireToken();
    const [media, viewer] = await Promise.all([this.entryOf(id), this.requireViewer()]);
    return entryForm(media, viewer);
  }

  async didSubmitEntryForm(id: string, form: Record<string, unknown>): Promise<void> {
    await this.requireToken();
    const [media, viewer] = await Promise.all([this.entryOf(id), this.requireViewer()]);
    const update = submittedUpdate(form, scoreFormatOf(viewer));
    if (!media.mediaListEntry && update.status === undefined) {
      update.status = defaultStatus(STATUS_OPTIONS);
    }
    if (Object.keys(update).length === 0) return;
    await this.save(media.id, update);
  }

  async getAuthenticatedUser(): Promise<User | null> {
    let viewer: Viewer | null;
    try {
      viewer = await this.viewer();
    } catch (error) {
      if ((await this.tokens.get()) === null) return null;
      throw error;
    }
    if (!viewer) return null;
    return {
      handle: viewer.name,
      displayName: viewer.name,
      avatar: viewer.avatar?.large ?? undefined,
      bannerImage: viewer.bannerImage ?? undefined,
      info: viewerStats(viewer),
    };
  }

  async handleUserSignOut(): Promise<void> {
    await this.tokens.clear();
    this.viewerCache = undefined;
  }

  async getOAuthRequestURL(): Promise<OAuthURL> {
    const clientId = (await this.preferences.get(PreferenceID.ClientId)).trim() || CLIENT_ID;
    return oauthRequest(
      AUTHORIZE_URL,
      { client_id: clientId, response_type: "token" },
      REDIRECT_URL,
      { sendRedirectUri: false },
    );
  }

  async handleOAuthCallback(response: string): Promise<void> {
    const params = parseParams(response);
    if (params["error"]) {
      throw new Error(`AniList sign-in failed: ${params["error_description"] ?? params["error"]}`);
    }
    const token = params["access_token"];
    if (!token) {
      throw new Error(
        `AniList did not return an access token. Check that the client's redirect URL is ${REDIRECT_URL}.`,
      );
    }
    await this.tokens.save(token, Number.parseInt(params["expires_in"] ?? "", 10));
    this.viewerCache = undefined;
    await this.rememberAccount();
  }

  private async signedInFields(token: string, name: string): Promise<UIListElement[]> {
    const expiresAt = await this.tokens.expiresAt();
    const expiry = expiresAt ? `, expires ${new Date(expiresAt).toISOString().slice(0, 10)}` : "";
    return [
      UITextField({
        id: `${info.id}.account-status`,
        title: "Account",
        value: `Signed in as ${name}`,
      }),
      UITextField({
        id: `${info.id}.token-status`,
        title: "Token",
        value: `Token ${maskToken(token)}${expiry}`,
      }),
      UIButton({
        id: `${info.id}.sign-out`,
        title: `Sign Out of ${name}`,
        isDestructive: true,
        action: async () => {
          await this.handleUserSignOut();
        },
      }),
    ];
  }

  /** Looks the account up once after signing in, so settings can name it offline. */
  private async rememberAccount(): Promise<void> {
    try {
      const viewer = await this.viewer();
      if (viewer) await this.tokens.setAccount(viewer.name);
    } catch {
      // A failed lookup leaves the name unknown; the token itself is still valid or will
      // be cleared by the next request that AniList rejects.
    }
  }

  private tokenField(signedIn: boolean): UIListElement {
    return UITextField({
      id: `${info.id}.access-token-input`,
      title: "Access Token",
      placeholder: signedIn
        ? "Access token — signed in, paste a new one to replace"
        : "Access token (optional)",
      secure: true,
      optional: true,
      value: "",
      didChange: async (value: string) => {
        // The field reports every edit; only a whole token replaces the saved one,
        // so a half-typed or half-pasted value never signs the user out.
        const token = value.trim();
        if (!isAccessToken(token)) return;
        await this.tokens.save(token, jwtExpiresIn(token));
        this.viewerCache = undefined;
        await this.rememberAccount();
      },
    });
  }

  private async query<T>(query: string, variables: GraphQLVariables = {}): Promise<T> {
    const token = await this.tokens.get();
    try {
      return await graphql<T>(this.http, API_URL, query, variables, token);
    } catch (error) {
      if (!token || !isInvalidToken(error)) throw error;
      await this.handleUserSignOut();
      try {
        return await graphql<T>(this.http, API_URL, query, variables, null);
      } catch {
        throw new Error("Your AniList session has expired. Sign in again.");
      }
    }
  }

  private async requireToken(): Promise<string> {
    const token = await this.tokens.get();
    if (!token) throw new Error("Sign in to AniList to track titles.");
    return token;
  }

  private async viewer(): Promise<Viewer | null> {
    const token = await this.tokens.get();
    if (!token) return null;
    if (this.viewerCache?.token === token) return this.viewerCache.viewer;
    const { Viewer } = await this.query<ViewerResponse>(VIEWER_QUERY);
    this.viewerCache = { token, viewer: Viewer };
    if ((await this.tokens.account()) !== Viewer.name) await this.tokens.setAccount(Viewer.name);
    return Viewer;
  }

  private async requireViewer(): Promise<Viewer> {
    const viewer = await this.viewer();
    if (!viewer) throw new Error("Sign in to AniList to track titles.");
    return viewer;
  }

  private async display(context?: SourceContext): Promise<Display> {
    const showAdult = await this.preferences.get(PreferenceID.ShowAdult);
    const allowed = context?.allowedContentRatings;
    return {
      titleLanguage: await this.preferences.get(PreferenceID.TitleLanguage),
      allowAdult: showAdult && (!allowed || allowed.includes(ContentRating.EXPLICIT)),
    };
  }

  private async trackingOptions(): Promise<TrackingOptions> {
    return {
      autoComplete: await this.preferences.get(PreferenceID.AutoComplete),
      autoDates: await this.preferences.get(PreferenceID.AutoDates),
    };
  }

  private async tagOptions(allowAdult: boolean): Promise<Option[]> {
    if (!this.tagCache) {
      try {
        const { MediaTagCollection } =
          await this.query<TagCollectionResponse>(TAG_COLLECTION_QUERY);
        this.tagCache = MediaTagCollection.map((tag) => ({
          option: { id: `${TAG_PREFIX}${tag.name}`, title: tag.name },
          isAdult: Boolean(tag.isAdult),
        })).sort((a, b) => a.option.title.localeCompare(b.option.title));
      } catch {
        return [];
      }
    }
    return this.tagCache.filter((tag) => allowAdult || !tag.isAdult).map((tag) => tag.option);
  }

  private async entryOf(id: string): Promise<EntryMedia> {
    const { Media } = await this.query<MediaEntryResponse>(ENTRY_QUERY, {
      id: numericId(id, "AniList id"),
    });
    return Media;
  }

  private async save(mediaId: number, update: EntryUpdate): Promise<void> {
    await this.query(SAVE_ENTRY_MUTATION, { mediaId, ...update });
  }

  private async browse(
    variables: GraphQLVariables,
    page: number,
    context?: SourceContext,
  ): Promise<PagedSearchResult> {
    const display = await this.display(context);
    const signedIn = (await this.tokens.get()) !== null;
    const { Page } = await this.query<MediaPageResponse>(SEARCH_QUERY, {
      ...variables,
      page,
      perPage: PAGE_SIZE,
      isAdult: display.allowAdult ? undefined : false,
      withEntry: signedIn,
    });
    return {
      results: Page.media.map((media) => toHighlight(media, display)),
      isLastPage: !Page.pageInfo?.hasNextPage,
    };
  }

  private async userList(status: string, page: number): Promise<PagedSearchResult> {
    if (!isKnownStatus(STATUS_OPTIONS, status)) return { results: [], isLastPage: true };
    const viewer = await this.requireViewer();
    const display = await this.display();
    const { Page } = await this.query<MediaListPageResponse>(MEDIA_LIST_QUERY, {
      userId: viewer.id,
      status,
      page,
      perPage: PAGE_SIZE,
    });
    return {
      results: Page.mediaList.map((item) => {
        const entry = trackEntry(item, item.media.chapters);
        return toHighlight(item.media, display, progressLabel(entry, item.media.chapters), entry);
      }),
      isLastPage: !Page.pageInfo?.hasNextPage,
    };
  }
}

function mediaUrl(id: number): string {
  return `${SITE_URL}/manga/${id}`;
}

/** AniList access tokens are JWTs: three base64url segments, around a thousand characters. */
function isAccessToken(value: string): boolean {
  return value.length > 100 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
}

function isInvalidToken(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid token|unauthori[sz]ed|HTTP 401/i.test(message);
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

function genreOptions(allowAdult: boolean): Option[] {
  const genres = allowAdult ? [...GENRES, ...ADULT_GENRES] : GENRES;
  return genres.map((genre) => ({ id: genre, title: genre }));
}

function genresOf(ids: readonly string[]): string[] {
  return ids.filter((id) => !id.startsWith(TAG_PREFIX));
}

function tagsOf(ids: readonly string[]): string[] {
  return ids.filter((id) => id.startsWith(TAG_PREFIX)).map((id) => id.slice(TAG_PREFIX.length));
}

function sortKey(request: SearchRequest, query: string): string {
  if (query && !request.sort) return "SEARCH_MATCH";
  const id = resolveSortId(SORT_OPTIONS, request, SortID.Popularity);
  const option = SORT_OPTIONS.find((candidate) => candidate.id === id);
  const ascending = request.sort?.ascending ?? option?.defaultAscending ?? false;
  return ascending ? id : `${id}_DESC`;
}

function titleOf(title: MediaTitle, language: string): string {
  const preferred =
    language === TitleLanguage.Romaji
      ? title.romaji
      : language === TitleLanguage.English
        ? title.english
        : language === TitleLanguage.Native
          ? title.native
          : title.userPreferred;
  return (
    preferred || title.userPreferred || title.romaji || title.english || title.native || "Untitled"
  );
}

function coverOf(media: MediaSummary): string {
  return media.coverImage?.extraLarge ?? media.coverImage?.large ?? "";
}

function ratingOf(media: MediaSummary & { genres?: string[] | null }): ContentRating {
  if (media.isAdult) return ContentRating.EXPLICIT;
  if (media.genres?.includes("Ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function statusOf(status: string | null | undefined): PublicationStatus | undefined {
  switch (status) {
    case "RELEASING":
      return PublicationStatus.ONGOING;
    case "FINISHED":
      return PublicationStatus.COMPLETED;
    case "HIATUS":
      return PublicationStatus.HIATUS;
    case "CANCELLED":
      return PublicationStatus.CANCELLED;
    default:
      return undefined;
  }
}

function contentTypeOf(media: MediaSummary): ContentType {
  if (media.format === "NOVEL") return ContentType.NOVEL;
  if (media.countryOfOrigin === "KR") return ContentType.MANHWA;
  if (media.countryOfOrigin === "CN" || media.countryOfOrigin === "TW") return ContentType.MANHUA;
  return ContentType.MANGA;
}

function formatLabel(format: string | null | undefined): string {
  return optionTitle(FORMAT_OPTIONS, format);
}

function summaryLine(media: MediaSummary): string {
  return [
    formatLabel(media.format),
    media.startDate?.year ? String(media.startDate.year) : "",
    media.averageScore ? `${media.averageScore}%` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function trackEntry(
  entry: Pick<MediaListEntry, "status" | "progress" | "progressVolumes">,
  chapters: number | null | undefined,
): TrackEntry {
  return {
    status: entry.status,
    progress: {
      lastReadChapter: entry.progress ?? 0,
      maxAvailableChapter: chapters ?? undefined,
      lastReadVolume: entry.progressVolumes ?? undefined,
    },
  };
}

function progressLabel(entry: TrackEntry, chapters: number | null | undefined): string {
  return `Ch. ${entry.progress.lastReadChapter}${chapters ? ` / ${chapters}` : ""}`;
}

function toHighlight(
  media: MediaSummary,
  display: Display,
  subtitle?: string,
  entry?: TrackEntry,
): Highlight {
  const listed =
    entry ?? (media.mediaListEntry ? trackEntry(media.mediaListEntry, media.chapters) : undefined);
  const badge = entry ? undefined : statusTitle(media.mediaListEntry?.status);
  return {
    id: String(media.id),
    title: titleOf(media.title, display.titleLanguage),
    cover: coverOf(media),
    subtitle: subtitle || summaryLine(media) || undefined,
    contentRating: ratingOf(media),
    webUrl: media.siteUrl ?? mediaUrl(media.id),
    info: highlightInfo(media),
    ...(badge ? { badge: { text: badge } } : {}),
    ...(listed ? { entry: listed } : {}),
  };
}

function optionTitle(options: readonly Option[], id: string | null | undefined): string {
  if (!id) return "";
  return options.find((option) => option.id === id)?.title ?? "";
}

function statusTitle(status: string | null | undefined): string {
  return optionTitle(STATUS_OPTIONS, status);
}

function highlightInfo(media: MediaSummary): Pair[] {
  const pairs: Pair[] = [
    { key: "Format", value: formatLabel(media.format) },
    { key: "Status", value: optionTitle(MEDIA_STATUS_OPTIONS, media.status) },
    { key: "Chapters", value: media.chapters ? String(media.chapters) : "" },
    { key: "Volumes", value: media.volumes ? String(media.volumes) : "" },
    { key: "Score", value: media.averageScore ? `${media.averageScore}%` : "" },
    { key: "Year", value: media.startDate?.year ? String(media.startDate.year) : "" },
  ];
  return pairs.filter((pair) => pair.value);
}

function panelModeOf(media: MediaSummary): ReadingMode | undefined {
  if (media.format === "NOVEL") return undefined;
  if (
    media.countryOfOrigin === "KR" ||
    media.countryOfOrigin === "CN" ||
    media.countryOfOrigin === "TW"
  ) {
    return ReadingMode.WEBTOON;
  }
  return ReadingMode.PAGED_MANGA;
}

function alternateTitles(media: MediaDetail, primary: string): string[] {
  const titles = [
    media.title.romaji,
    media.title.english,
    media.title.native,
    ...(media.synonyms ?? []),
  ].filter((title): title is string => Boolean(title) && title !== primary);
  return [...new Set(titles)];
}

function contentTags(media: MediaDetail, allowAdult: boolean): Tag[] {
  const genres: Tag[] = (media.genres ?? []).map((genre) => ({
    id: genre,
    title: genre,
    contentRating: ADULT_GENRES.includes(genre)
      ? ContentRating.EXPLICIT
      : genre === "Ecchi"
        ? ContentRating.SUGGESTIVE
        : undefined,
  }));
  const tags: Tag[] = (media.tags ?? [])
    .filter((tag) => !tag.isMediaSpoiler && !tag.isGeneralSpoiler && (allowAdult || !tag.isAdult))
    .map((tag) => ({
      id: `${TAG_PREFIX}${tag.name}`,
      title: tag.name,
      contentRating: tag.isAdult ? ContentRating.EXPLICIT : undefined,
    }));
  return [...genres, ...tags];
}

function trackerIds(media: MediaDetail): Record<string, string> {
  const ids: Record<string, string> = { anilist: String(media.id) };
  if (media.idMal) ids["mal"] = String(media.idMal);
  return ids;
}

function readableRole(role: string | null | undefined): string | undefined {
  if (!role) return undefined;
  return role
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function mangaOnly(
  entries: readonly (MediaSummary | null | undefined)[],
  display: Display,
): MediaSummary[] {
  return entries
    .filter((media): media is MediaSummary => Boolean(media) && media?.type === "MANGA")
    .filter((media) => display.allowAdult || !media.isAdult);
}

function mangaHighlights(entries: readonly MediaSummary[], display: Display): SimpleHighlight[] {
  return entries.map((media) =>
    additionalInfo.highlights.item({
      type: AdditionalInfoType.Highlights,
      id: String(media.id),
      title: titleOf(media.title, display.titleLanguage),
      cover: coverOf(media),
      contentRating: ratingOf(media),
      webUrl: media.siteUrl ?? mediaUrl(media.id),
    }),
  );
}

function personEdges(connection: PersonConnection | null | undefined): PersonEdge[] {
  return (connection?.edges ?? []).filter((edge) => Boolean(edge.node));
}

function characterItems(connection: PersonConnection | null | undefined): CharacterItem[] {
  return personEdges(connection).map((edge) =>
    additionalInfo.characters.item({
      id: String(edge.node?.id),
      title: edge.node?.name?.userPreferred ?? "Unknown",
      subtitle: readableRole(edge.role),
      image: edge.node?.image?.medium ?? undefined,
    }),
  );
}

function staffItems(connection: PersonConnection | null | undefined): StaffItem[] {
  return personEdges(connection).map((edge) =>
    additionalInfo.staff.item({
      id: String(edge.node?.id),
      title: edge.node?.name?.userPreferred ?? "Unknown",
      subtitle: edge.role ?? undefined,
      image: edge.node?.image?.medium ?? undefined,
    }),
  );
}

function relationItems(
  media: MediaConnections,
  display: Display,
  limit: number,
): SimpleHighlight[] {
  const related = mangaOnly(
    (media.relations?.edges ?? []).map((edge) => edge.node),
    display,
  );
  return mangaHighlights(related.slice(0, limit), display);
}

function recommendationItems(
  media: MediaConnections,
  display: Display,
  limit: number,
): SimpleHighlight[] {
  const recommended = mangaOnly(
    (media.recommendations?.nodes ?? []).map((node) => node.mediaRecommendation),
    display,
  );
  return mangaHighlights(recommended.slice(0, limit), display);
}

function infoSections(media: MediaDetail, display: Display): AdditionalInfoSection[] {
  const sections: AdditionalInfoSection[] = [];

  const characters = characterItems(media.characters);
  if (characters.length > 0) {
    sections.push(
      additionalInfo.characters.section({
        id: InfoSectionID.Characters,
        title: "Characters",
        hasMore: false,
        items: characters,
      }),
    );
  }

  const staff = staffItems(media.staff);
  if (staff.length > 0) {
    sections.push(
      additionalInfo.staff.section({
        id: InfoSectionID.Staff,
        title: "Staff",
        hasMore: false,
        items: staff,
      }),
    );
  }

  const relations = relationItems(media, display, DETAIL_ITEMS);
  if (relations.length > 0) {
    sections.push(
      additionalInfo.highlights.section({
        id: InfoSectionID.Relations,
        title: "Relations",
        hasMore: false,
        items: relations,
      }),
    );
  }

  const recommendations = recommendationItems(media, display, DETAIL_ITEMS);
  if (recommendations.length > 0) {
    sections.push(
      additionalInfo.highlights.section({
        id: InfoSectionID.Recommendations,
        title: "Recommendations",
        hasMore: false,
        items: recommendations,
      }),
    );
  }

  const links = [
    additionalInfo.links.item({
      id: "anilist",
      title: "AniList",
      url: media.siteUrl ?? mediaUrl(media.id),
    }),
    ...(media.idMal
      ? [
          additionalInfo.links.item({
            id: "mal",
            title: "MyAnimeList",
            url: `${MAL_URL}/manga/${media.idMal}`,
          }),
        ]
      : []),
    ...(media.externalLinks ?? []).flatMap((link) =>
      link.url
        ? [additionalInfo.links.item({ id: String(link.id), title: link.site, url: link.url })]
        : [],
    ),
  ];
  sections.push(
    additionalInfo.links.section({ id: InfoSectionID.Links, title: "Links", items: links }),
  );

  return sections;
}

function parseContent(media: MediaDetail, display: Display): Content {
  const title = titleOf(media.title, display.titleLanguage);
  return {
    title,
    cover: coverOf(media),
    contentRating: ratingOf(media),
    webUrl: media.siteUrl ?? mediaUrl(media.id),
    status: statusOf(media.status),
    summary: plainText(media.description),
    additionalTitles: alternateTitles(media, title),
    tags: contentTags(media, display.allowAdult),
    contentType: contentTypeOf(media),
    recommendedPanelMode: panelModeOf(media),
    additionalInfo: infoSections(media, display),
    trackerInfo: trackerIds(media),
  };
}

function hasDate(date: FuzzyDate | null | undefined): boolean {
  return Boolean(date?.year);
}

function today(): FuzzyDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function wholeNumber(value: number | undefined, max?: number | null): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const whole = Math.max(0, Math.floor(value));
  return max ? Math.min(whole, max) : whole;
}

function progressUpdate(
  media: EntryMedia,
  progress: TrackProgressUpdate,
  options: TrackingOptions,
): EntryUpdate | undefined {
  const entry = media.mediaListEntry ?? undefined;
  const chapter = wholeNumber(progress.chapter, media.chapters);
  const volume = wholeNumber(progress.volume, media.volumes);
  const update: EntryUpdate = {};

  if (chapter !== undefined && chapter > (entry?.progress ?? 0)) update.progress = chapter;
  if (volume !== undefined && volume > (entry?.progressVolumes ?? 0))
    update.progressVolumes = volume;
  if (update.progress === undefined && update.progressVolumes === undefined) return undefined;

  const current = entry?.status;
  let next = current ?? ListStatus.Current;
  if (
    current === ListStatus.Planning ||
    current === ListStatus.Paused ||
    current === ListStatus.Dropped
  ) {
    next = ListStatus.Current;
  }

  const reached = update.progress ?? entry?.progress ?? 0;
  const finished =
    options.autoComplete && Boolean(media.chapters) && reached >= (media.chapters ?? 0);
  if (finished && next !== ListStatus.Completed) {
    if (current === ListStatus.Repeating) update.repeat = (entry?.repeat ?? 0) + 1;
    next = ListStatus.Completed;
  }

  if (options.autoDates) {
    if (next === ListStatus.Current && !hasDate(entry?.startedAt)) update.startedAt = today();
    if (next === ListStatus.Completed) {
      if (!hasDate(entry?.startedAt)) update.startedAt = today();
      if (!hasDate(entry?.completedAt) || current === ListStatus.Repeating)
        update.completedAt = today();
    }
  }

  if (next !== current) update.status = next;
  return update;
}

function statusUpdate(media: EntryMedia, status: string, options: TrackingOptions): EntryUpdate {
  const entry = media.mediaListEntry ?? undefined;
  const update: EntryUpdate = { status };

  if (
    status === ListStatus.Completed &&
    media.chapters &&
    (entry?.progress ?? 0) < media.chapters
  ) {
    update.progress = media.chapters;
  }
  if (options.autoDates) {
    const started = status === ListStatus.Current || status === ListStatus.Completed;
    if (started && !hasDate(entry?.startedAt)) update.startedAt = today();
    if (status === ListStatus.Completed && !hasDate(entry?.completedAt))
      update.completedAt = today();
  }
  return update;
}

function scoreFormatOf(viewer: Viewer): string {
  return viewer.mediaListOptions?.scoreFormat ?? ScoreFormat.Point100;
}

function closestOption(score: number, options: readonly Option[]): string {
  let best = options[0]?.id ?? "0";
  let distance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const gap = Math.abs(Number(option.id) - score);
    if (gap < distance) {
      best = option.id;
      distance = gap;
    }
  }
  return best;
}

function scoreField(format: string, raw: number): UIListElement {
  const title = "Score";
  switch (format) {
    case ScoreFormat.Point5:
    case ScoreFormat.Point3: {
      const options = format === ScoreFormat.Point5 ? STAR_SCORES : SMILEY_SCORES;
      return UIPicker({ id: EntryField.Score, title, options, value: closestOption(raw, options) });
    }
    case ScoreFormat.Point10Decimal:
      return UIStepper({
        id: EntryField.Score,
        title,
        value: raw / 10,
        lowerBound: 0,
        upperBound: 10,
        step: 0.1,
        allowDecimal: true,
      });
    case ScoreFormat.Point10:
      return UIStepper({
        id: EntryField.Score,
        title,
        value: Math.round(raw / 10),
        lowerBound: 0,
        upperBound: 10,
        step: 1,
      });
    default:
      return UIStepper({
        id: EntryField.Score,
        title,
        value: raw,
        lowerBound: 0,
        upperBound: 100,
        step: 1,
      });
  }
}

function dateOf(date: FuzzyDate | null | undefined): Date | null {
  if (!date?.year) return null;
  return new Date(date.year, (date.month ?? 1) - 1, date.day ?? 1);
}

function entryForm(media: EntryMedia, viewer: Viewer): Form {
  const entry = media.mediaListEntry ?? undefined;
  const lists = viewer.mediaListOptions?.mangaList?.customLists ?? [];
  const enabledLists = (entry?.customLists ?? [])
    .filter((list) => list.enabled)
    .map((list) => list.name);

  const visibility: UIListElement[] = [
    UIToggle({ id: EntryField.Private, title: "Private", value: entry?.private ?? false }),
    UIToggle({
      id: EntryField.HiddenFromStatusLists,
      title: "Hide From Status Lists",
      value: entry?.hiddenFromStatusLists ?? false,
    }),
  ];
  if (lists.length > 0) {
    visibility.unshift(
      UIMultiPicker({
        id: EntryField.CustomLists,
        title: "Custom Lists",
        options: lists.map((name) => ({ id: name, title: name })),
        value: enabledLists,
      }),
    );
  }

  return {
    sections: [
      UIListSection({
        children: [
          UIPicker({
            id: EntryField.Status,
            title: "Status",
            options: STATUS_OPTIONS.map(({ id, title }) => ({ id, title })),
            value: entry?.status ?? defaultStatus(STATUS_OPTIONS),
          }),
          scoreField(scoreFormatOf(viewer), entry?.score ?? 0),
        ],
      }),
      UIListSection({
        header: "Progress",
        children: [
          UIStepper({
            id: EntryField.Progress,
            title: media.chapters ? `Chapters (of ${media.chapters})` : "Chapters",
            value: entry?.progress ?? 0,
            lowerBound: 0,
            ...(media.chapters ? { upperBound: media.chapters } : {}),
            step: 1,
          }),
          UIStepper({
            id: EntryField.ProgressVolumes,
            title: media.volumes ? `Volumes (of ${media.volumes})` : "Volumes",
            value: entry?.progressVolumes ?? 0,
            lowerBound: 0,
            ...(media.volumes ? { upperBound: media.volumes } : {}),
            step: 1,
          }),
          UIStepper({
            id: EntryField.Repeat,
            title: "Rereads",
            value: entry?.repeat ?? 0,
            lowerBound: 0,
            step: 1,
          }),
        ],
      }),
      UIListSection({
        header: "Dates",
        children: [
          UIDatePicker({
            id: EntryField.StartedAt,
            title: "Started",
            optional: true,
            value: dateOf(entry?.startedAt),
          }),
          UIDatePicker({
            id: EntryField.CompletedAt,
            title: "Finished",
            optional: true,
            value: dateOf(entry?.completedAt),
          }),
        ],
      }),
      UIListSection({
        header: "Notes",
        children: [
          UITextField({
            id: EntryField.Notes,
            title: "Notes",
            optional: true,
            value: entry?.notes ?? "",
          }),
        ],
      }),
      UIListSection({ header: "Visibility", children: visibility }),
    ],
  };
}

function rawScore(value: unknown, format: string): number {
  const number = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(number)) return 0;
  const scaled =
    typeof value === "string" || format === ScoreFormat.Point100 ? number : number * 10;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

function fuzzyFromSubmission(value: unknown): FuzzyDate | undefined {
  if (value === null) return { year: null, month: null, day: null };
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const date = new Date(parsed);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function submittedUpdate(form: Record<string, unknown>, scoreFormat: string): EntryUpdate {
  const read = new FilterReader({ filters: form as Record<string, FilterPrimitives> });
  const has = (key: string) => Object.prototype.hasOwnProperty.call(form, key);
  const update: EntryUpdate = {};

  if (has(EntryField.Status) && isKnownStatus(STATUS_OPTIONS, read.text(EntryField.Status))) {
    update.status = read.text(EntryField.Status);
  }
  if (has(EntryField.Score)) {
    const value = form[EntryField.Score];
    const option =
      typeof value === "object" && value !== null ? read.text(EntryField.Score) : value;
    update.scoreRaw = rawScore(option, scoreFormat);
  }
  if (has(EntryField.Progress)) update.progress = wholeNumber(read.number(EntryField.Progress, 0));
  if (has(EntryField.ProgressVolumes)) {
    update.progressVolumes = wholeNumber(read.number(EntryField.ProgressVolumes, 0));
  }
  if (has(EntryField.Repeat)) update.repeat = wholeNumber(read.number(EntryField.Repeat, 0));
  if (has(EntryField.StartedAt)) update.startedAt = fuzzyFromSubmission(form[EntryField.StartedAt]);
  if (has(EntryField.CompletedAt)) {
    update.completedAt = fuzzyFromSubmission(form[EntryField.CompletedAt]);
  }
  if (has(EntryField.Notes)) {
    const notes = form[EntryField.Notes];
    update.notes = typeof notes === "string" ? notes : "";
  }
  if (has(EntryField.Private)) update.private = read.toggle(EntryField.Private);
  if (has(EntryField.HiddenFromStatusLists)) {
    update.hiddenFromStatusLists = read.toggle(EntryField.HiddenFromStatusLists);
  }
  if (has(EntryField.CustomLists)) update.customLists = read.options(EntryField.CustomLists);

  for (const key of Object.keys(update) as (keyof EntryUpdate)[]) {
    if (update[key] === undefined) delete update[key];
  }
  return update;
}

function viewerStats(viewer: Viewer): string[] {
  const stats = viewer.statistics?.manga;
  if (!stats) return [];
  return [
    stats.count ? `${stats.count} titles` : "",
    stats.chaptersRead ? `${stats.chaptersRead} chapters read` : "",
    stats.meanScore ? `Mean score ${stats.meanScore}` : "",
  ].filter(Boolean);
}

export class Target extends AniListTracker {}
