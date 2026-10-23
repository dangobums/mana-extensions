import {
  BasicAuthenticationUIIdentifier,
  Body,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  UIListSection,
  UITextField,
  additionalInfo,
  type AdditionalInfoSection,
  type BasicAuthenticatable,
  type Chapter,
  type ChapterData,
  type ChapterEventHandler,
  type ChapterSource,
  type Content,
  type ContentProgressState,
  type CoverRequestHandler,
  type DeepLinkContext,
  type Form,
  type FormSection,
  type Highlight,
  type HttpClient,
  type HttpRequest,
  type JsonValue,
  type Option,
  type PageLinkLabel,
  type PageLinkProvider,
  type PageRequestHandler,
  type PagedSearchResult,
  type Pair,
  type ProgressSyncHandler,
  type QueryParams,
  type SearchForm,
  type SearchListField,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type SourcePreferenceProvider,
  type Tag,
  type UIListElement,
  type User as ManaUser,
} from "@mana-app/types";

import { basicAuthorization, originOf, type ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  withQuery,
  type PreferenceSection,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import { SecretStore } from "../../lib/secrets.ts";
import { BaseSource } from "../../lib/source.ts";
import { plainText } from "../../lib/tracker.ts";
import {
  API,
  CONNECTION_TIMEOUT_MS,
  FilterID,
  LIBRARY_PREFIX,
  ListID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PROJECT_URL,
  PreferenceID,
  SORT_OPTIONS,
  STATIC_FIELDS,
  SUPPORTED_IMAGE_TYPES,
  SecretID,
  SortID,
  optionSheet,
  type Book,
  type BookPage,
  type Library,
  type Page,
  type SearchCondition,
  type Series,
  type User,
} from "./model.ts";

const info: SourceInfo = {
  id: "komga",
  name: "Komga",
  version: "1.0.1",
  description: "Read and sync your own Komga server",
  website: PROJECT_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.UNIVERSAL],
  thumbnail: "Komga.png",
  developers: [{ name: "dangobums", github: "https://github.com/dangobums" }],
};

const config: SourceConfig = {
  allowsMultipleInstances: true,
};

type Credentials =
  | { kind: "api-key"; apiKey: string }
  | { kind: "password"; username: string; password: string }
  | { kind: "none" };

class KomgaSource
  extends BaseSource
  implements
    ChapterSource,
    SearchProvider,
    SourcePreferenceProvider,
    BasicAuthenticatable,
    ChapterEventHandler,
    ProgressSyncHandler,
    CoverRequestHandler,
    PageRequestHandler,
    PageLinkProvider
{
  readonly info = info;
  readonly config = config;
  readonly BasicAuthUIIdentifier = BasicAuthenticationUIIdentifier.EMAIL;
  // mana-dev reads this name for the email-login intent; the typed name above is not checked.
  readonly BasicAuthenticationUIIdentifier = BasicAuthenticationUIIdentifier.EMAIL;

  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);
  private readonly secrets = new SecretStore(info.id);
  private credentialCache: Credentials | undefined;

  protected clientOptions(): ClientOptions {
    return {
      baseUrl: PROJECT_URL,
      requests: 10,
      intervalMs: 1_000,
      json: true,
      retry: 2,
      originFor: (url) => originOf(url) ?? PROJECT_URL,
      authorize: (request) => this.authorize(request),
    };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.KeepReading,
        title: "Keep Reading",
        style: SectionStyle.SimpleHero,
        load: (page) => this.bookList("books/ondeck", page),
      },
      {
        id: ListID.RecentlyAdded,
        title: "Recently Added Series",
        load: (page) => this.seriesList("series/new", page),
      },
      {
        id: ListID.LatestBooks,
        title: "Latest Books",
        style: SectionStyle.DetailedVerticalList,
        load: (page) => this.bookList("books/latest", page),
      },
      {
        id: ListID.RecentlyUpdated,
        title: "Recently Updated Series",
        load: (page) => this.seriesList("series/updated", page),
      },
    ];
  }

  getCoverTransport(): HttpClient {
    return this.imageHttp;
  }

  getPageTransport(): HttpClient {
    return this.imageHttp;
  }

  async getPreferenceMenu(): Promise<Form> {
    const status = await this.connectionStatus();
    const server = await buildPreferenceMenu(this.preferences, this.serverSections(status));
    const browsing = await buildPreferenceMenu(this.preferences, this.browsingSections());
    const sections: FormSection[] = [
      ...server.sections,
      UIListSection({
        header: "API Key",
        footer:
          "Recommended. Create one in Komga under Account Settings → API Keys. When set, it is used instead of email and password.",
        children: [await this.secretField(SecretID.ApiKey, "API Key", true)],
      }),
      UIListSection({
        header: "Email and Password",
        footer:
          "Used when no API key is set. You can also sign in with these from Mana's account screen for this source.",
        children: [
          await this.secretField(SecretID.Username, "Email", false),
          await this.secretField(SecretID.Password, "Password", true),
        ],
      }),
      ...browsing.sections,
    ];
    return { sections };
  }

  async getSearchForm(): Promise<SearchForm> {
    const fields: SearchListField[] = [];
    let genres: Option[] = [];
    if (await this.isConfigured()) {
      const [libraries, publishers, tags, genreNames] = await Promise.all([
        this.libraries().catch(() => []),
        this.api<string[]>("publishers").catch(() => []),
        this.api<string[]>("tags/series").catch(() => []),
        this.api<string[]>("genres").catch(() => []),
      ]);
      if (libraries.length > 1) {
        fields.push(optionSheet(FilterID.Library, "Libraries", libraries.map(libraryOption)));
      }
      fields.push(...STATIC_FIELDS);
      if (publishers.length > 0) {
        fields.push(optionSheet(FilterID.Publisher, "Publisher", publishers.map(nameOption)));
      }
      if (tags.length > 0) {
        fields.push(
          SearchExcludableMultiPickerSheet({
            id: FilterID.Tag,
            title: "Tags",
            options: tags.map(nameOption),
          }),
        );
      }
      genres = genreNames.map(nameOption);
    } else {
      fields.push(...STATIC_FIELDS);
    }

    return buildSearchForm({
      header: "Filters",
      fields,
      ...(genres.length > 0
        ? {
            tags: SearchExcludableMultiPickerSheet({
              id: FilterID.Genre,
              title: "Genres",
              options: genres,
            }),
            tagsHeader: "Genres",
          }
        : {}),
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const filters = new FilterReader(request);
    const libraryId = request.listId?.startsWith(LIBRARY_PREFIX)
      ? request.listId.slice(LIBRARY_PREFIX.length)
      : undefined;
    const libraries = libraryId
      ? [libraryId]
      : filters.options(FilterID.Library).length > 0
        ? filters.options(FilterID.Library)
        : await this.preferences.get(PreferenceID.DefaultLibraries);

    const genres = filters.excludable(FilterID.Genre);
    const tags = filters.excludable(FilterID.Tag);
    const conditions: SearchCondition[] = [
      { deleted: { operator: "isFalse" } },
      anyOf("libraryId", libraries),
      anyOf("readStatus", filters.options(FilterID.ReadStatus)),
      anyOf("seriesStatus", filters.options(FilterID.SeriesStatus)),
      anyOf("publisher", filters.options(FilterID.Publisher)),
      ...genres.included.map((value) => is("genre", value)),
      ...genres.excluded.map((value) => isNot("genre", value)),
      ...tags.included.map((value) => is("tag", value)),
      ...tags.excluded.map((value) => isNot("tag", value)),
    ].filter((condition): condition is SearchCondition => condition !== undefined);

    const query = request.query?.trim() ?? "";
    const page = pageOf(request);
    const result = await this.post<Page<Series>>(
      "series/list",
      { condition: { allOf: conditions }, ...(query ? { fullTextSearch: query } : {}) },
      { page: page - 1, size: PAGE_SIZE, ...sortParam(request, query) },
    );
    const server = await this.server();
    return {
      results: result.content.map((series) => seriesHighlight(series, server)),
      isLastPage: result.last,
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const series = await this.api<Series>(`series/${encodeURIComponent(contentId)}`);
    return parseSeries(series, await this.server());
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const [series, books] = await Promise.all([
      this.api<Series>(`series/${encodeURIComponent(contentId)}`),
      this.books(contentId),
    ]);
    const server = await this.server();
    return books.map((book, index) => toChapter(book, index, series, server));
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const id = encodeURIComponent(chapterId);
    const pages = await this.api<BookPage[]>(`books/${id}/pages`);
    if (pages.length === 0) throw new Error(`Komga has no pages for book ${chapterId}`);
    const base = `${await this.server()}${API}/books/${id}/pages`;
    return {
      pages: pages.map((page) => ({
        url: SUPPORTED_IMAGE_TYPES.includes(page.mediaType)
          ? `${base}/${page.number}`
          : `${base}/${page.number}?convert=png`,
      })),
    };
  }

  async getProgressState(contentId: string): Promise<ContentProgressState> {
    const books = await this.books(contentId);
    const readChapterIds = books
      .filter((book) => book.readProgress?.completed)
      .map((book) => book.id);
    const current = books
      .filter(
        (book) => book.readProgress && !book.readProgress.completed && book.readProgress.page > 0,
      )
      .sort((a, b) => readTime(b) - readTime(a))[0];
    return {
      readChapterIds,
      ...(current?.readProgress
        ? {
            currentReadingState: {
              chapterId: current.id,
              page: current.readProgress.page,
              progress: Math.min(
                1,
                current.readProgress.page / Math.max(1, current.media.pagesCount),
              ),
              readDate: new Date(readTime(current)),
            },
          }
        : {}),
    };
  }

  async onChapterRead(_contentId: string, chapterId: string): Promise<void> {
    await this.markBook(chapterId, true);
  }

  async onChaptersMarked(
    _contentId: string,
    chapterIds: string[],
    completed: boolean,
  ): Promise<void> {
    for (const chapterId of chapterIds) await this.markBook(chapterId, completed);
  }

  async onPageRead(_contentId: string, chapterId: string, page: number): Promise<void> {
    if (!Number.isFinite(page)) return;
    await this.patch(`books/${encodeURIComponent(chapterId)}/read-progress`, {
      page: Math.max(1, Math.floor(page)),
    });
  }

  async getLibraryPageLinks(): Promise<PageLinkLabel[]> {
    if (!(await this.isConfigured())) return [];
    const libraries = await this.libraries().catch(() => []);
    return libraries.map((library) => ({
      title: library.name,
      link: { request: { page: 1, listId: `${LIBRARY_PREFIX}${library.id}` } },
    }));
  }

  async handleURL(url: string): Promise<DeepLinkContext | null> {
    const server = await this.server().catch(() => "");
    if (!server || !url.startsWith(server)) return null;
    const id = /\/series\/([A-Za-z0-9]+)/.exec(url)?.[1];
    if (!id) return null;
    const series = await this.api<Series>(`series/${id}`);
    return { content: seriesHighlight(series, server) };
  }

  async getAuthenticatedUser(): Promise<ManaUser | null> {
    const credentials = await this.credentials();
    if (credentials.kind === "none" || !(await this.serverUrl())) return null;
    try {
      const user = await this.me();
      return {
        handle: user.email,
        displayName: user.email,
        info: [
          hostOf(await this.server()),
          credentials.kind === "api-key" ? "API key" : "Email and password",
        ],
      };
    } catch {
      return null;
    }
  }

  async handleBasicAuth(identifier: string, password: string): Promise<void> {
    if (!(await this.serverUrl())) {
      throw new Error("Set your Komga server address in this source's settings first.");
    }
    await this.secrets.set(SecretID.Username, identifier);
    await this.secrets.set(SecretID.Password, password);
    this.credentialCache = undefined;
    try {
      await this.me();
    } catch (error) {
      await this.secrets.clear(SecretID.Username, SecretID.Password);
      this.credentialCache = undefined;
      throw error;
    }
  }

  async handleUserSignOut(): Promise<void> {
    await this.secrets.clear(SecretID.ApiKey, SecretID.Username, SecretID.Password);
    this.credentialCache = undefined;
  }

  private serverSections(status: string): PreferenceSection[] {
    return [
      {
        header: "Server",
        footer: `The address you open Komga at, e.g. http://192.168.1.10:25600. ${status}`,
        fields: [
          {
            type: "text",
            key: PreferenceID.ServerUrl,
            title: "Server Address",
            placeholder: "Server address, e.g. http://192.168.1.10:25600",
          },
        ],
      },
    ];
  }

  private browsingSections(): PreferenceSection[] {
    return [
      {
        header: "Browsing",
        footer:
          "Search and the home page only show these libraries. Leave empty for all of them. The list fills in once the source has connected (open its home page).",
        fields: [
          {
            type: "multiselect",
            key: PreferenceID.DefaultLibraries,
            title: "Default Libraries",
            options: async () => (await this.cachedLibraries()).map(libraryOption),
          },
        ],
      },
    ];
  }

  private async secretField(key: string, title: string, secure: boolean): Promise<UIListElement> {
    const saved = await this.secrets.has(key);
    const shown = secure ? "" : await this.secrets.get(key);
    return UITextField({
      id: this.secrets.keyFor(key),
      title,
      value: shown,
      secure,
      optional: true,
      placeholder: saved && secure ? `${title} — saved, type to replace` : title,
      ...(key === SecretID.Username ? { keyboard: "email" as const } : {}),
      didChange: async (value: string) => {
        await this.secrets.set(key, value);
        this.credentialCache = undefined;
        await ObjectStore.remove(this.preferences.keyFor(StoreID.LastCheck));
      },
    });
  }

  /**
   * The app rebuilds this menu on every edit to find the changed field, so it must not
   * touch the network: it shows the outcome of the last real connection instead.
   */
  private async connectionStatus(): Promise<string> {
    const server = await this.serverUrl();
    if (!server) return "Not set up yet.";
    if ((await this.credentials()).kind === "none") {
      return "Add an API key or an email and password below.";
    }
    const last = await readStored<LastCheck>(this.preferences.keyFor(StoreID.LastCheck));
    if (!last || last.server !== server) {
      return "Not checked yet: open the source's home page, then reopen these settings.";
    }
    return last.message;
  }

  private async recordCheck(message: string): Promise<void> {
    const server = await this.serverUrl();
    await ObjectStore.set(this.preferences.keyFor(StoreID.LastCheck), { server, message });
  }

  private async cachedLibraries(): Promise<Library[]> {
    const cached = await readStored<{ server: string; libraries: Library[] }>(
      this.preferences.keyFor(StoreID.Libraries),
    );
    return cached && cached.server === (await this.serverUrl()) ? cached.libraries : [];
  }

  private async serverUrl(): Promise<string> {
    return normalizeServer(await this.preferences.get(PreferenceID.ServerUrl));
  }

  private async server(): Promise<string> {
    const server = await this.serverUrl();
    if (!server) throw new Error("Set your Komga server address in this source's settings.");
    return server;
  }

  private async isConfigured(): Promise<boolean> {
    return Boolean(await this.serverUrl()) && (await this.credentials()).kind !== "none";
  }

  private async credentials(): Promise<Credentials> {
    if (this.credentialCache) return this.credentialCache;
    const apiKey = await this.secrets.get(SecretID.ApiKey);
    const username = await this.secrets.get(SecretID.Username);
    const password = await this.secrets.get(SecretID.Password);
    this.credentialCache = apiKey
      ? { kind: "api-key", apiKey }
      : username && password
        ? { kind: "password", username, password }
        : { kind: "none" };
    return this.credentialCache;
  }

  /** Credentials only ever go to the configured server, never to another host. */
  private async authorize(request: HttpRequest): Promise<void> {
    const server = await this.serverUrl();
    if (!server || !request.url.startsWith(server)) return;
    const credentials = await this.credentials();
    if (credentials.kind === "api-key") request.headers.set("x-api-key", credentials.apiKey);
    if (credentials.kind === "password") {
      request.headers.set(
        "authorization",
        basicAuthorization(credentials.username, credentials.password),
      );
    }
  }

  private async me(): Promise<User> {
    const server = await this.server();
    try {
      const response = await this.http.get(`${server}/api/v2/users/me`, {
        timeoutMs: CONNECTION_TIMEOUT_MS,
      });
      const user = await response.json<User>();
      const via = (await this.credentials()).kind === "api-key" ? "API key" : "email and password";
      await this.recordCheck(`Connected as ${user.email} with ${via}.`);
      return user;
    } catch (error) {
      const explained = explain(error);
      await this.recordCheck(`Could not connect: ${explained.message}`);
      throw explained;
    }
  }

  private async api<T>(path: string, params?: QueryParams): Promise<T> {
    const server = await this.server();
    try {
      const response = await this.http.get(withQuery(`${server}${API}/${path}`, flatten(params)));
      return await response.json<T>();
    } catch (error) {
      throw explain(error);
    }
  }

  private async post<T>(path: string, body: JsonValue, params?: QueryParams): Promise<T> {
    const server = await this.server();
    try {
      const response = await this.http.post(
        withQuery(`${server}${API}/${path}`, flatten(params)),
        Body.json(body),
      );
      return await response.json<T>();
    } catch (error) {
      throw explain(error);
    }
  }

  private async patch(path: string, body: JsonValue): Promise<void> {
    const server = await this.server();
    try {
      await this.http.patch(`${server}${API}/${path}`, Body.json(body));
    } catch (error) {
      throw explain(error);
    }
  }

  private async markBook(bookId: string, completed: boolean): Promise<void> {
    const path = `books/${encodeURIComponent(bookId)}/read-progress`;
    if (completed) {
      await this.patch(path, { completed: true });
      return;
    }
    const server = await this.server();
    try {
      await this.http.delete(`${server}${API}/${path}`);
    } catch (error) {
      throw explain(error);
    }
  }

  private async libraries(): Promise<Library[]> {
    const libraries = (await this.api<Library[]>("libraries"))
      .filter((library) => !library.unavailable)
      .map((library) => ({ id: library.id, name: library.name }));
    await ObjectStore.set(this.preferences.keyFor(StoreID.Libraries), {
      server: await this.serverUrl(),
      libraries,
    });
    return libraries;
  }

  private async books(seriesId: string): Promise<Book[]> {
    const page = await this.post<Page<Book>>(
      "books/list",
      {
        condition: {
          allOf: [is("seriesId", seriesId), { deleted: { operator: "isFalse" } }],
        },
      },
      { unpaged: true, sort: "metadata.numberSort,asc" },
    );
    return page.content.filter(isReadable);
  }

  private async libraryParams(): Promise<QueryParams> {
    const libraries = await this.preferences.get(PreferenceID.DefaultLibraries);
    return libraries.length > 0 ? { library_id: libraries.join(",") } : {};
  }

  private async seriesList(path: string, page: number): Promise<PagedSearchResult> {
    const result = await this.api<Page<Series>>(path, {
      page: page - 1,
      size: PAGE_SIZE,
      deleted: false,
      ...(await this.libraryParams()),
    });
    const server = await this.server();
    return {
      results: result.content.map((series) => seriesHighlight(series, server)),
      isLastPage: result.last,
    };
  }

  private async bookList(path: string, page: number): Promise<PagedSearchResult> {
    const result = await this.api<Page<Book>>(path, {
      page: page - 1,
      size: PAGE_SIZE,
      ...(await this.libraryParams()),
    });
    const server = await this.server();
    const seen = new Set<string>();
    const results: Highlight[] = [];
    for (const book of result.content) {
      if (seen.has(book.seriesId)) continue;
      seen.add(book.seriesId);
      results.push(bookHighlight(book, server));
    }
    return { results, isLastPage: result.last };
  }
}

type LastCheck = { server: string; message: string };

const StoreID = {
  LastCheck: "last-check",
  Libraries: "library-cache",
} as const;

/** A value this source wrote itself, read back untyped (typed reads lose falsy values). */
async function readStored<T>(key: string): Promise<T | undefined> {
  try {
    const value = await ObjectStore.get(key);
    return value && typeof value === "object" ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeServer(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
}

function hostOf(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

function flatten(params?: QueryParams): Record<string, string | number | boolean | undefined> {
  const result: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    result[key] = Array.isArray(value) ? value.join(",") : (value as string | number | boolean);
  }
  return result;
}

function explain(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401/.test(message)) {
    return new Error(
      "Komga rejected the credentials. Check the API key or email and password in this source's settings.",
    );
  }
  if (/HTTP 403/.test(message)) {
    return new Error("This Komga account is not allowed to do that (HTTP 403).");
  }
  return error instanceof Error ? error : new Error(message);
}

function is(field: string, value: string): SearchCondition {
  return { [field]: { operator: "is", value } };
}

function isNot(field: string, value: string): SearchCondition {
  return { [field]: { operator: "isNot", value } };
}

function anyOf(field: string, values: readonly string[]): SearchCondition | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return is(field, values[0] ?? "");
  return { anyOf: values.map((value) => is(field, value)) };
}

function sortParam(request: SearchRequest, query: string): QueryParams {
  if (query && !request.sort) return {};
  const id = resolveSortId(SORT_OPTIONS, request, SortID.Title);
  const option = SORT_OPTIONS.find((candidate) => candidate.id === id);
  const ascending = request.sort?.ascending ?? option?.defaultAscending ?? true;
  return { sort: `${id},${ascending ? "asc" : "desc"}` };
}

function nameOption(name: string): Option {
  return { id: name, title: name };
}

function libraryOption(library: Library): Option {
  return { id: library.id, title: library.name };
}

function isReadable(book: Book): boolean {
  if (book.media.status !== "READY") return false;
  const profile = book.media.mediaProfile ?? "DIVINA";
  return profile === "DIVINA" || profile === "PDF" || Boolean(book.media.epubDivinaCompatible);
}

function readTime(book: Book): number {
  const parsed = Date.parse(book.readProgress?.readDate ?? book.readProgress?.lastModified ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function seriesThumbnail(server: string, id: string): string {
  return `${server}${API}/series/${encodeURIComponent(id)}/thumbnail`;
}

function plainSummary(raw: string): string {
  return plainText(raw)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/^#+\s*/gm, "")
    .trim();
}

function ratingOf(series: Series): ContentRating {
  const genres = series.metadata.genres.map((genre) => genre.toLowerCase());
  if (genres.includes("hentai")) return ContentRating.EXPLICIT;
  if ((series.metadata.ageRating ?? 0) >= 18) return ContentRating.MATURE;
  if (genres.some((genre) => ["adult", "mature", "smut"].includes(genre)))
    return ContentRating.MATURE;
  if (genres.includes("ecchi")) return ContentRating.SUGGESTIVE;
  return ContentRating.SAFE;
}

function statusOf(status: string): PublicationStatus | undefined {
  switch (status) {
    case "ONGOING":
      return PublicationStatus.ONGOING;
    case "ENDED":
      return PublicationStatus.COMPLETED;
    case "ABANDONED":
      return PublicationStatus.CANCELLED;
    case "HIATUS":
      return PublicationStatus.HIATUS;
    default:
      return undefined;
  }
}

function readingOf(direction: string): { type?: ContentType; mode?: ReadingMode } {
  switch (direction) {
    case "RIGHT_TO_LEFT":
      return { type: ContentType.MANGA, mode: ReadingMode.PAGED_MANGA };
    case "LEFT_TO_RIGHT":
      return { type: ContentType.COMIC, mode: ReadingMode.PAGED_COMIC };
    case "VERTICAL":
      return { mode: ReadingMode.PAGED_VERTICAL };
    case "WEBTOON":
      return { mode: ReadingMode.WEBTOON };
    default:
      return {};
  }
}

function languageOf(code: string): string {
  switch (code.toLowerCase().split(/[-_]/)[0]) {
    case "en":
      return DefinedLanguages.ENGLISH;
    case "ja":
      return DefinedLanguages.JAPANESE;
    case "ko":
      return DefinedLanguages.KOREAN;
    case "zh":
      return DefinedLanguages.CHINESE;
    case "fr":
      return DefinedLanguages.FRENCH;
    case "es":
      return DefinedLanguages.SPANISH;
    case "pt":
      return DefinedLanguages.PORTUGUESE;
    default:
      return code || DefinedLanguages.UNIVERSAL;
  }
}

const TRACKER_LINKS: readonly [string, RegExp][] = [
  ["anilist", /anilist\.co\/manga\/(\d+)/i],
  ["mal", /myanimelist\.net\/manga\/(\d+)/i],
  ["mangaupdates", /mangaupdates\.com\/series\/([a-z0-9]+)/i],
  ["kitsu", /kitsu\.(?:app|io)\/manga\/([a-z0-9-]+)/i],
  ["mangadex", /mangadex\.org\/title\/([0-9a-f-]{36})/i],
];

function trackerIds(series: Series): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const link of series.metadata.links ?? []) {
    for (const [key, pattern] of TRACKER_LINKS) {
      const id = pattern.exec(link.url)?.[1];
      if (id && !ids[key]) ids[key] = id;
    }
  }
  return ids;
}

function seriesSubtitle(series: Series): string {
  const unread = series.booksUnreadCount ?? 0;
  if (unread > 0 && unread < series.booksCount) return `${unread} unread`;
  return `${series.booksCount} ${series.booksCount === 1 ? "book" : "books"}`;
}

function seriesInfo(series: Series): Pair[] {
  return [
    { key: "Books", value: String(series.booksCount) },
    { key: "Status", value: series.metadata.status ? titleCase(series.metadata.status) : "" },
    { key: "Publisher", value: series.metadata.publisher },
  ].filter((pair) => pair.value);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function seriesHighlight(series: Series, server: string): Highlight {
  return {
    id: series.id,
    title: series.metadata.title || series.name,
    cover: seriesThumbnail(server, series.id),
    subtitle: seriesSubtitle(series),
    contentRating: ratingOf(series),
    webUrl: `${server}/series/${series.id}`,
    info: seriesInfo(series),
  };
}

function bookHighlight(book: Book, server: string): Highlight {
  return {
    id: book.seriesId,
    title: book.seriesTitle,
    cover: seriesThumbnail(server, book.seriesId),
    subtitle: chapterTitle(book, book.seriesTitle),
    webUrl: `${server}/series/${book.seriesId}`,
  };
}

function chapterTitle(book: Book, seriesTitle: string): string {
  const title = (book.metadata.title || book.name).trim();
  const stripped =
    seriesTitle && title.startsWith(seriesTitle) ? title.slice(seriesTitle.length).trim() : title;
  return stripped.replace(/^[-–:·]\s*/, "") || title;
}

function toChapter(book: Book, index: number, series: Series, server: string): Chapter {
  const date = Date.parse(book.metadata.releaseDate ?? book.created ?? "");
  return {
    chapterId: book.id,
    number: Number.isFinite(book.metadata.numberSort) ? book.metadata.numberSort : index + 1,
    index,
    date: Number.isFinite(date) ? new Date(date) : new Date(0),
    language: languageOf(series.metadata.language),
    title: chapterTitle(book, series.metadata.title || series.name),
    webUrl: `${server}/book/${book.id}`,
  };
}

function staffSection(series: Series): AdditionalInfoSection | undefined {
  const roles = new Map<string, string[]>();
  for (const author of series.booksMetadata.authors) {
    const list = roles.get(author.name) ?? [];
    if (!list.includes(author.role)) list.push(author.role);
    roles.set(author.name, list);
  }
  if (roles.size === 0) return undefined;
  return additionalInfo.staff.section({
    id: "staff",
    title: "Staff",
    hasMore: false,
    items: [...roles.entries()].slice(0, 10).map(([name, list]) =>
      additionalInfo.staff.item({
        id: name,
        title: name,
        subtitle: list.map(titleCase).join(", "),
      }),
    ),
  });
}

function parseSeries(series: Series, server: string): Content {
  const metadata = series.metadata;
  const reading = readingOf(metadata.readingDirection);
  const title = metadata.title || series.name;
  const tags: Tag[] = metadata.genres.map((genre) => ({ id: genre, title: genre }));
  const sections: AdditionalInfoSection[] = [];

  const staff = staffSection(series);
  if (staff) sections.push(staff);

  const extraTags = [...new Set([...metadata.tags, ...(series.booksMetadata.tags ?? [])])];
  if (extraTags.length > 0) {
    sections.push(
      additionalInfo.tags.section({
        id: "tags",
        title: "Tags",
        items: extraTags.map((tag) =>
          additionalInfo.tags.item({ id: tag, title: tag, isNonInteractive: true }),
        ),
      }),
    );
  }

  sections.push(
    additionalInfo.links.section({
      id: "links",
      title: "Links",
      items: [
        additionalInfo.links.item({
          id: "komga",
          title: "Open in Komga",
          url: `${server}/series/${series.id}`,
        }),
        ...(metadata.links ?? []).map((link, index) =>
          additionalInfo.links.item({
            id: `link-${index}`,
            title: link.label || link.url,
            url: link.url,
          }),
        ),
      ],
    }),
  );

  return {
    title,
    cover: seriesThumbnail(server, series.id),
    contentRating: ratingOf(series),
    webUrl: `${server}/series/${series.id}`,
    status: statusOf(metadata.status),
    summary: plainSummary(metadata.summary || series.booksMetadata.summary),
    additionalTitles: [
      ...new Set(
        (metadata.alternateTitles ?? []).map((alt) => alt.title).filter((alt) => alt !== title),
      ),
    ],
    tags,
    ...(reading.type === undefined ? {} : { contentType: reading.type }),
    ...(reading.mode === undefined ? {} : { recommendedPanelMode: reading.mode }),
    additionalInfo: sections,
    trackerInfo: trackerIds(series),
  };
}

export class Target extends KomgaSource {}
