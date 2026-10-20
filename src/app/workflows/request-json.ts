export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Calls one of the app's JSON endpoints. Never throws: a failure carries the
 * server's error message, or `fallback`, or a network message.
 */
export async function requestJson<T>(
  url: string,
  options: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    fallback: string;
  },
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      ...(options.body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.body),
          }),
    });
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }

  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || body === null) {
    return { ok: false, error: body?.error ?? options.fallback };
  }
  return { ok: true, data: body };
}
