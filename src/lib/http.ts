// Small browser helpers for talking to our API routes.

/**
 * The JSON body of a response, or {} when there isn't one: an error from the hosting platform
 * (request too large, gateway timeout) is an HTML or text page, and reading it as JSON would
 * replace the useful "save failed" message with a parser error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonBody(res: Response): Promise<Record<string, any>> {
  try {
    const data: unknown = await res.json();
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The error message to show for a failed request. */
export function errorMessage(res: Response, data: Record<string, unknown>, fallback: string): string {
  if (typeof data.error === "string" && data.error) return data.error;
  if (res.status === 413) return "That was too large to send.";
  if (res.status >= 500) return `${fallback} The server didn't answer properly (${res.status}). Try again in a moment.`;
  return fallback;
}
