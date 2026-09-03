import { NextResponse } from "next/server";

/** `{ data: … }` on success, `{ error: { code, message } }` on failure. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function fail(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Wrap a handler so thrown errors become a 500 envelope instead of an HTML page. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      return fail("internal", message, 500);
    }
  };
}
