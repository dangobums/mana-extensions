import { Body, type HttpClient, type JsonValue } from "@mana-app/types";

export type GraphQLVariables = Record<string, JsonValue | undefined>;

type GraphQLError = { message?: string; status?: number };

type GraphQLResponse<T> = {
  data?: T | null;
  errors?: GraphQLError[];
};

export class GraphQLRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GraphQLRequestError";
    this.status = status;
  }
}

function describe(errors: readonly GraphQLError[]): string {
  return errors
    .map((error) => error.message ?? "")
    .filter(Boolean)
    .join("; ");
}

function definedOnly(variables: GraphQLVariables): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** Posts one GraphQL operation. Unset (`undefined`) variables are left out. */
export async function graphql<T>(
  client: HttpClient,
  endpoint: string,
  query: string,
  variables: GraphQLVariables = {},
  token?: string | null,
): Promise<T> {
  const response = await client.post(
    endpoint,
    Body.json({ query: query.trim(), variables: definedOnly(variables) }),
    {
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  let parsed: GraphQLResponse<T>;
  try {
    parsed = await response.json<GraphQLResponse<T>>();
  } catch {
    throw new GraphQLRequestError(
      `${endpoint} did not return JSON (HTTP ${response.status})`,
      response.status,
    );
  }

  const errors = parsed.errors ?? [];
  if (errors.length > 0 && !parsed.data) {
    throw new GraphQLRequestError(describe(errors) || "GraphQL request failed", errors[0]?.status);
  }
  if (!parsed.data) {
    throw new GraphQLRequestError(`${endpoint} returned no data`, response.status);
  }
  return parsed.data;
}
