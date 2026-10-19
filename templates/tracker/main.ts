import {
  Body,
  CatalogRating,
  HttpMethod,
  ContentRating,
  SectionStyle,
  UIListSection,
  UIPicker,
  UIStepper,
  type Content,
  type ContentTracker,
  type Form,
  type Highlight,
  type JsonValue,
  type OAuthURL,
  type OAuthAuthenticatable,
  type PagedSearchResult,
  type SearchRequest,
  type SourceInfo,
  type SourcePreferenceProvider,
  type TrackEntry,
  type TrackProgressUpdate,
  type TrackerConfig,
  type TrackerStatusOption,
  type User,
} from "@mana-app/types";

import type { ClientOptions } from "../../lib/client.ts";
import {
  PreferenceStore,
  buildPreferenceMenu,
  pageOf,
  parseParams,
  withQuery,
  type PreferenceSection,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  TokenStore,
  defaultStatus,
  isKnownStatus,
  numericId,
  oauthRequest,
  plainText,
} from "../../lib/tracker.ts";
import {
  API_URL,
  AUTHORIZE_URL,
  EntryField,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  REDIRECT_URL,
  SITE_URL,
  STATUS_OPTIONS,
  type ApiEntry,
  type ApiPage,
  type ApiTitle,
  type ApiUser,
} from "./model.ts";

const info: SourceInfo = {
  id: "template-tracker",
  name: "TemplateTracker",
  version: "1.0.0",
  description: "Starting point for a Mana tracker",
  website: SITE_URL,
  rating: CatalogRating.MIXED,
  thumbnail: "TemplateTracker.png",
  developers: [{ name: "Developer" }],
};

const trackerConfig: TrackerConfig = {
  linkKeys: ["template-tracker"],
  owningLinks: ["example.com"],
};

class TemplateTrackerSource
  extends BaseSource
  implements ContentTracker, OAuthAuthenticatable, SourcePreferenceProvider
{
  readonly info = info;
  readonly trackerConfig = trackerConfig;

  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);
  private readonly tokens = new TokenStore(info.id);

  protected clientOptions(): ClientOptions {
    return { baseUrl: SITE_URL, json: true, requests: 1, intervalMs: 1_000 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: "popular",
        title: "Popular",
        style: SectionStyle.SimpleHero,
        load: (page) => this.results("/titles", { sort: "popular", page }),
      },
    ];
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Account",
        fields: [{ type: "text", key: PreferenceID.ClientId, title: "Client ID" }],
      },
      {
        header: "Content",
        fields: [{ type: "toggle", key: PreferenceID.ShowAdult, title: "Show Adult Titles" }],
      },
    ];
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, this.preferenceSections());
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;
    const showAdult = await this.preferences.get(PreferenceID.ShowAdult);
    return this.results("/titles", {
      q: request.query?.trim() ?? "",
      page: pageOf(request),
      adult: showAdult ? "1" : undefined,
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const title = await this.api<ApiTitle>(`/titles/${numericId(contentId)}`);
    return {
      title: title.title,
      cover: title.cover ?? "",
      summary: plainText(title.description),
      contentRating: title.adult ? ContentRating.EXPLICIT : ContentRating.SAFE,
      webUrl: `${SITE_URL}/title/${title.id}`,
      trackerInfo: { [info.id]: String(title.id) },
    };
  }

  async getStatusOptions(): Promise<TrackerStatusOption[]> {
    return STATUS_OPTIONS;
  }

  async getTrackEntry(id: string): Promise<TrackEntry | null> {
    if ((await this.tokens.get()) === null) return null;
    const entry = await this.api<ApiEntry | null>(`/me/list/${numericId(id)}`);
    return entry ? { status: entry.status, progress: { lastReadChapter: entry.progress } } : null;
  }

  async removeTracking(id: string): Promise<void> {
    await this.send(HttpMethod.Delete, `/me/list/${numericId(id)}`);
  }

  async didUpdateLastReadChapter(id: string, progress: TrackProgressUpdate): Promise<void> {
    if (progress.chapter === undefined) return;
    await this.send(HttpMethod.Patch, `/me/list/${numericId(id)}`, {
      progress: Math.floor(progress.chapter),
    });
  }

  async didUpdateStatus(id: string, status: string): Promise<void> {
    if (!isKnownStatus(STATUS_OPTIONS, status)) throw new Error(`Unknown status "${status}"`);
    await this.send(HttpMethod.Patch, `/me/list/${numericId(id)}`, { status });
  }

  async getEntryForm(id: string): Promise<Form> {
    const entry = await this.getTrackEntry(id);
    return {
      sections: [
        UIListSection({
          children: [
            UIPicker({
              id: EntryField.Status,
              title: "Status",
              options: STATUS_OPTIONS.map(({ id: optionId, title }) => ({ id: optionId, title })),
              value: entry?.status ?? defaultStatus(STATUS_OPTIONS),
            }),
            UIStepper({
              id: EntryField.Progress,
              title: "Chapters",
              value: entry?.progress.lastReadChapter ?? 0,
              lowerBound: 0,
              step: 1,
            }),
          ],
        }),
      ],
    };
  }

  async didSubmitEntryForm(id: string, form: Record<string, JsonValue>): Promise<void> {
    if (Object.keys(form).length === 0) return;
    await this.send(HttpMethod.Patch, `/me/list/${numericId(id)}`, form);
  }

  async getAuthenticatedUser(): Promise<User | null> {
    if ((await this.tokens.get()) === null) return null;
    const user = await this.api<ApiUser>("/me");
    return { handle: user.name, avatar: user.avatar };
  }

  async handleUserSignOut(): Promise<void> {
    await this.tokens.clear();
  }

  async getOAuthRequestURL(): Promise<OAuthURL> {
    const clientId = (await this.preferences.get(PreferenceID.ClientId)).trim();
    if (!clientId) throw new Error("Add your client ID in the tracker settings first.");
    return oauthRequest(
      AUTHORIZE_URL,
      { client_id: clientId, response_type: "token" },
      REDIRECT_URL,
    );
  }

  async handleOAuthCallback(response: string): Promise<void> {
    const params = parseParams(response);
    const token = params["access_token"];
    if (!token) throw new Error(params["error_description"] ?? "No access token was returned.");
    await this.tokens.save(token, Number.parseInt(params["expires_in"] ?? "", 10));
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokens.get();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  private async api<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const response = await this.http.get(withQuery(`${API_URL}${path}`, params), {
      headers: await this.headers(),
    });
    return response.json<T>();
  }

  private async send(
    method: HttpMethod,
    path: string,
    body?: Record<string, JsonValue>,
  ): Promise<void> {
    if ((await this.tokens.get()) === null) throw new Error("Sign in to track titles.");
    await this.http.request(
      {
        url: `${API_URL}${path}`,
        method,
        ...(body === undefined ? {} : { body: Body.json(body) }),
      },
      { headers: await this.headers() },
    );
  }

  private async results(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<PagedSearchResult> {
    const page = await this.api<ApiPage<ApiTitle>>(path, { ...params, limit: PAGE_SIZE });
    return { results: page.items.map(toHighlight), isLastPage: !page.hasNextPage };
  }
}

function toHighlight(title: ApiTitle): Highlight {
  return {
    id: String(title.id),
    title: title.title,
    cover: title.cover ?? "",
    contentRating: title.adult ? ContentRating.EXPLICIT : ContentRating.SAFE,
    webUrl: `${SITE_URL}/title/${title.id}`,
  };
}

export class Target extends TemplateTrackerSource {}
