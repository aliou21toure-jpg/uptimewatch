/** Client-side helper for /api/v1: returns data or throws an Error carrying the API message. */
export async function apiFetch<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(
    path,
    json === undefined
      ? rest
      : { ...rest, headers: { "content-type": "application/json", ...rest.headers }, body: JSON.stringify(json) },
  );
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message: string; details?: { message: string }[] } } | null;
  if (!res.ok) {
    const detail = body?.error?.details?.[0]?.message;
    throw new Error([body?.error?.message ?? `Request failed (${res.status})`, detail].filter(Boolean).join(": "));
  }
  return body?.data as T;
}
