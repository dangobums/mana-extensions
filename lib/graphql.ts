export type GraphQLVariables = Record<string, unknown>;

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

/**
 * Posts one GraphQL operation. The body is handed to the host as an object so
 * it serialises it as JSON, matching the `content-type` header set here.
 */
export async function graphql<T>(
  client: NetworkClient,
  endpoint: string,
  query: string,
  variables: GraphQLVariables = {},
  token?: string | null,
): Promise<T> {
  const response = await client.post(endpoint, {
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: { query: query.trim(), variables },
  });

  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(response.data) as GraphQLResponse<T>;
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
