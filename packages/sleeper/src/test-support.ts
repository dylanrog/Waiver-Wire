import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Load a checked-in Sleeper fixture by name (no extension). */
export function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../tests/fixtures/sleeper/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export interface MockRoute {
  status?: number;
  body: unknown;
}

/** A `fetch` that serves canned responses, matched by URL suffix. */
export function mockFetch(routes: Record<string, MockRoute>): typeof fetch {
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const key = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (key === undefined) return new Response("no route", { status: 404 });
    const route = routes[key];
    return new Response(JSON.stringify(route?.body ?? null), {
      status: route?.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return impl as typeof fetch;
}

/** A `fetch` that never responds but rejects when its abort signal fires. */
export function hangingFetch(): typeof fetch {
  const impl = (_input: unknown, init?: { signal?: AbortSignal }): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted", "AbortError")),
      );
    });
  return impl as typeof fetch;
}

/** A `fetch` whose first `failures` calls return `status`, then succeeds with `body`. */
export function flakyFetch(failures: number, status: number, body: unknown): typeof fetch {
  let calls = 0;
  const impl = async (): Promise<Response> => {
    calls += 1;
    if (calls <= failures) return new Response("try again", { status });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return impl as typeof fetch;
}
