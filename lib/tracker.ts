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
  private readonly accountKey: string;

  constructor(namespace: string) {
    this.tokenKey = `${namespace}.access_token`;
    this.expiresKey = `${namespace}.expires_at`;
    this.accountKey = `${namespace}.account_name`;
  }

  async get(): Promise<string | null> {
    const token = await attempt(() => SecureStore.get(this.tokenKey));
    if (typeof token !== "string" || !token) return null;

    const expiresAt = await attempt(() => SecureStore.get(this.expiresKey));
    if (typeof expiresAt === "number" && Date.now() >= expiresAt) {
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

  /** When the saved token expires (epoch ms), or null when unknown. */
  async expiresAt(): Promise<number | null> {
    const value = await attempt(() => SecureStore.get(this.expiresKey));
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /**
   * The signed-in account's display name, kept beside the token so a settings menu can
   * show it without a request (the app rebuilds that menu on every edit).
   */
  async account(): Promise<string | null> {
    const value = await attempt(() => SecureStore.get(this.accountKey));
    return typeof value === "string" && value ? value : null;
  }

  async setAccount(name: string): Promise<void> {
    await SecureStore.set(this.accountKey, name);
  }

  async clear(): Promise<void> {
    await SecureStore.remove(this.tokenKey);
    await SecureStore.remove(this.expiresKey);
    await SecureStore.remove(this.accountKey);
  }
}

/** Enough of a token to recognise it, never enough to use it. */
export function maskToken(token: string): string {
  return token.length <= 12 ? "••••" : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodeBase64Url(value: string): string {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of value.replace(/=+$/, "")) {
    const index = BASE64URL.indexOf(char === "+" ? "-" : char === "/" ? "_" : char);
    if (index < 0) throw new Error("not base64url");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
}

/** Seconds until a JWT's `exp`, or undefined when it has none or is not a JWT. */
export function jwtExpiresIn(token: string): number | undefined {
  try {
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1] ?? "")) as { exp?: unknown };
    if (typeof payload.exp !== "number") return undefined;
    const seconds = Math.floor(payload.exp - Date.now() / 1000);
    return seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
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
