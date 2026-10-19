import {
  OutcomeKind,
  type OAuthURL,
  type RetryPolicy,
  type TrackerStatusOption,
} from "@mana-app/types";
import { withQuery } from "./forms/query.ts";

export type OAuthRequestOptions = {
  /**
   * Send `redirect_uri`. Providers whose implicit grant redirects to the URL
   * registered on the client (AniList) do not take it.
   */
  sendRedirectUri?: boolean;
};

/**
 * The query goes in `url` as well as `params`, since it is not known which of
 * the two the app uses to build the page it opens. Repeating identical keys is
 * harmless if it appends `params` to `url`.
 */
export function oauthRequest(
  url: string,
  params: Record<string, string>,
  redirectUri: string,
  options: OAuthRequestOptions = {},
): OAuthURL {
  const callbackScheme = /^([a-z][a-z0-9+.-]*):/i.exec(redirectUri)?.[1];
  if (!callbackScheme) throw new Error(`"${redirectUri}" is not a redirect URL with a scheme`);
  const query =
    options.sendRedirectUri === false ? params : { ...params, redirect_uri: redirectUri };
  return { url: withQuery(url, query), params: query, callbackScheme };
}

async function attempt<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * An OAuth access token kept in the keychain-backed SecureStore, together with
 * its expiry. An expired token is cleared on read so callers never send it.
 */
export class TokenStore {
  private readonly tokenKey: string;
  private readonly expiresKey: string;

  constructor(namespace: string) {
    this.tokenKey = `${namespace}.access_token`;
    this.expiresKey = `${namespace}.expires_at`;
  }

  async get(): Promise<string | null> {
    const token = await attempt(() => SecureStore.string(this.tokenKey));
    if (!token) return null;

    const expiresAt = await attempt(() => SecureStore.number(this.expiresKey));
    if (expiresAt !== null && Date.now() >= expiresAt) {
      await this.clear();
      return null;
    }
    return token;
  }

  async save(token: string, expiresInSeconds?: number): Promise<void> {
    await SecureStore.set(this.tokenKey, token);
    if (
      expiresInSeconds !== undefined &&
      Number.isFinite(expiresInSeconds) &&
      expiresInSeconds > 0
    ) {
      await SecureStore.set(this.expiresKey, Date.now() + expiresInSeconds * 1000);
    } else {
      await SecureStore.remove(this.expiresKey);
    }
  }

  async clear(): Promise<void> {
    await SecureStore.remove(this.tokenKey);
    await SecureStore.remove(this.expiresKey);
  }
}

export function defaultStatus(options: readonly TrackerStatusOption[]): string {
  return options.find((option) => option.isDefault)?.id ?? options[0]?.id ?? "";
}

export function isKnownStatus(options: readonly TrackerStatusOption[], status: string): boolean {
  return options.some((option) => option.id === status);
}

/** Tracker ids arrive as strings; most tracker APIs key media by integer. */
export function numericId(id: string, label = "id"): number {
  const value = Number.parseInt(id, 10);
  if (!Number.isFinite(value) || value <= 0 || String(value) !== id.trim()) {
    throw new Error(`"${id}" is not a valid ${label}`);
  }
  return value;
}

/** Strips the HTML some tracker APIs put in descriptions. */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The client only retries GET and HEAD by default. Tracker APIs that answer
 * every call with POST (GraphQL) still want a rate-limited request repeated;
 * the wait follows the server's `Retry-After`.
 */
export function retryRateLimited(maxRetries = 2): RetryPolicy {
  return {
    maxRetries,
    shouldRetry: ({ outcome }) => outcome.kind === OutcomeKind.Response && outcome.status === 429,
  };
}
