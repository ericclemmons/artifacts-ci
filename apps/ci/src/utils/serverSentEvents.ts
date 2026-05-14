type ServerSentEvent = {
  event: string;
  data: string;
};

export function splitLines(value: string) {
  return value.split(/\r?\n/).filter(Boolean);
}

export async function* readServerSentEvents(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      yield parseServerSentEvent(part);
    }

    if (done) {
      if (buffer) yield parseServerSentEvent(buffer);
      break;
    }
  }
}

function parseServerSentEvent(value: string): ServerSentEvent {
  const event = { event: "message", data: "" };

  for (const line of value.split("\n")) {
    if (line.startsWith("event: ")) event.event = line.slice("event: ".length);
    if (line.startsWith("data: ")) event.data += `${line.slice("data: ".length)}\n`;
  }

  event.data = event.data.trimEnd();
  return event;
}
