import { apiAuthorizationHeaders, apiUrl } from "./api";

export type ServerEvent = { event: string; data: string };
export function parseServerEvents(buffer: string): { events: ServerEvent[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length || event !== "message" ? [{ event, data: data.join("\n") }] : [];
  });
  return { events, remainder };
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(finish, milliseconds);
    function finish() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runRefreshEventStream(path: string, token: string, signal: AbortSignal, onRefresh: () => void) {
  let retryDelay = 1_000;
  while (!signal.aborted) {
    try {
      const response = await fetch(apiUrl(path), {
        method: "GET",
        credentials: "same-origin",
        headers: apiAuthorizationHeaders(token, { Accept: "text/event-stream" }),
        signal,
      });
      if (!response.ok) throw new Error(`Refresh stream unavailable (${response.status}).`);
      if (!response.body) throw new Error("Refresh stream has no response body.");
      const connectedAt = Date.now();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const parsed = parseServerEvents(buffer);
        buffer = parsed.remainder;
        for (const item of parsed.events) {
          if (item.event === "refresh") {
            onRefresh();
          }
        }
      }
      if (Date.now() - connectedAt >= 30_000) retryDelay = 1_000;
      if (!signal.aborted) await wait(retryDelay, signal);
    } catch {
      if (signal.aborted) return;
      await wait(retryDelay, signal);
    }
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
}
