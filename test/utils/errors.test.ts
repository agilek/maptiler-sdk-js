import { describe, expect, it } from "vitest";
import { FetchError } from "../../src/utils/errors";

/** Minimal stand-in for the parts of `Response` that `FetchError` reads. */
function makeResponse(overrides: Partial<Response> = {}): Response {
  return {
    url: "https://api.maptiler.com/routing/v1/directions",
    status: 400,
    statusText: "Bad Request",
    ...overrides,
  } as Response;
}

//#region FetchError

describe("FetchError", () => {
  it("builds the standard message without a detail", () => {
    const error = new FetchError(makeResponse(), "directions", "routing.directions");

    expect(error.message).toBe("[routing.directions]: Failed to fetch directions at https://api.maptiler.com/routing/v1/directions: 400: Bad Request");
  });

  it("appends the service detail as a second sentence", () => {
    const error = new FetchError(makeResponse(), "directions", "routing.directions", "No route found between the given locations");

    expect(error.message).toMatch(/400: Bad Request\. No route found between the given locations$/);
    expect(error.detail).toBe("No route found between the given locations");
  });

  it("omits the detail separator when the detail is an empty string", () => {
    const error = new FetchError(makeResponse(), "directions", "routing.directions", "");

    expect(error.message).toMatch(/400: Bad Request$/);
  });

  it("exposes the status and keeps the FetchError name", () => {
    const error = new FetchError(makeResponse({ status: 429, statusText: "Too Many Requests" }), "directions", "routing.directions");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FetchError");
    expect(error.status).toBe(429);
    expect(error.statusText).toBe("Too Many Requests");
    expect(error.detail).toBeUndefined();
  });
});

//#endregion

//#region Build environment

describe("__MT_NODE_ENV__", () => {
  // Guards the fix for the define mismatch: vite.config-test.ts used to inject
  // `"true"`/`"false"` while every other config injected the environment name,
  // so development-only diagnostics were unreachable under Vitest.
  it("is the environment name, so development-only branches are reachable in tests", () => {
    expect(__MT_NODE_ENV__).toBe("development");
  });
});

//#endregion
