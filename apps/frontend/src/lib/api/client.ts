import type { ApiErrorResponse } from "./types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const apiKey = import.meta.env.VITE_API_KEY ?? "";

export function createUrl(pathname: string, searchParams?: URLSearchParams) {
  const url = new URL(pathname, apiBaseUrl || window.location.origin);

  if (searchParams) {
    url.search = searchParams.toString();
  }

  return url;
}

export async function apiGet<T>(pathname: string, searchParams?: URLSearchParams): Promise<T> {
  const response = await fetch(createUrl(pathname, searchParams), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(apiKey ? { "X-Api-Key": apiKey } : {})
    }
  });

  if (!response.ok) {
    let errorBody: ApiErrorResponse | undefined;

    try {
      errorBody = (await response.json()) as ApiErrorResponse;
    } catch {
      errorBody = undefined;
    }

    const message = errorBody?.error ?? `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as T;
}
