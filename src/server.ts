import { createStartHandler, defaultRenderHandler } from "@tanstack/react-start/server";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import "./lib/error-capture";

function brandedErrorResponse(error?: any): Response {
  return new Response(renderErrorPage(error), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(error);
  return brandedErrorResponse(error);
}

// TanStack Start's createStartHandler returns a function that takes a Request.
// Using the function form avoids the "cb is not a function" error caused by missing 'handler' property in options.
const handler = createStartHandler(defaultRenderHandler);

export default {
  async fetch(request: Request) {
    try {
      const response = await handler(request);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error('SSR Fetch Error:', error);
      return brandedErrorResponse(error);
    }
  },
};
