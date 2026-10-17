export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

function encodePairs(params: Record<string, QueryValue>, keepEmpty: boolean): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && (keepEmpty || value !== ""))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function withQuery(url: string, params?: QueryParams): string {
  const query = encodePairs(params ?? {}, false);
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

export function encodeForm(body: Record<string, QueryValue>): string {
  return encodePairs(body, true);
}

/**
 * Reads the query string and the fragment of a URL into one map, fragment
 * values winning. OAuth implicit grants return the token in the fragment.
 */
export function parseParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const query = /\?([^#]*)/.exec(url)?.[1] ?? "";
  const fragment = /#(.*)$/.exec(url)?.[1] ?? "";

  for (const part of [query, fragment]) {
    for (const pair of part.split("&")) {
      if (!pair) continue;
      const [rawKey = "", ...rest] = pair.split("=");
      const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      if (key) params[key] = decodeURIComponent(rest.join("=").replace(/\+/g, " "));
    }
  }
  return params;
}
