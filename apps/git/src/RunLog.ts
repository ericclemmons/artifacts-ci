import { Agent } from "agents";

type RunLogEvent = {
  id: number;
  line: string;
};

type RunLogState = {
  closed: boolean;
  events: RunLogEvent[];
};

export class RunLog extends Agent<Env, RunLogState> {
  initialState: RunLogState = { closed: false, events: [] };

  private subscribers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  async onRequest(request: Request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/append") {
      const body = await request.json<{ line?: string }>();

      if (!body.line) {
        return new Response("Missing line\n", { status: 400 });
      }

      await this.append(body.line);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/close") {
      await this.close();
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && url.pathname === "/stream") {
      return this.stream();
    }

    return new Response("Not found\n", { status: 404 });
  }

  private async append(line: string) {
    const events = [...this.state.events];
    const event = { id: events.at(-1)?.id ?? 0, line } satisfies RunLogEvent;
    event.id += 1;
    events.push(event);
    this.setState({ ...this.state, events });
    await this.broadcastRunEvent(event);
  }

  private async close() {
    this.setState({ ...this.state, closed: true });
    await this.broadcastRunEvent({ id: 0, line: "event: close" });
    await Promise.all([...this.subscribers].map((writer) => writer.close()));
    this.subscribers.clear();
  }

  private async stream() {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const { closed, events } = this.state;

    this.ctx.waitUntil(this.writeReplay(writer, events, closed));

    return new Response(readable, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
      },
    });
  }

  private async writeReplay(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    events: RunLogEvent[],
    closed: boolean,
  ) {
    for (const event of events) {
      await writer.write(encodeEvent(event));
    }

    if (closed) {
      await writer.write(encodeClose());
      await writer.close();
      return;
    }

    if (this.state.closed) {
      await writer.write(encodeClose());
      await writer.close();
      return;
    }

    this.subscribers.add(writer);
  }

  private async broadcastRunEvent(event: RunLogEvent) {
    const payload = event.line === "event: close" ? encodeClose() : encodeEvent(event);
    const writes = [...this.subscribers].map(async (writer) => {
      try {
        await writer.write(payload);
      } catch {
        this.subscribers.delete(writer);
      }
    });

    await Promise.all(writes);
  }
}

function encodeEvent(event: RunLogEvent) {
  const data = event.line
    .split(/\r?\n/)
    .map((line) => `data: ${line}`)
    .join("\n");

  return new TextEncoder().encode(`id: ${event.id}\n${data}\n\n`);
}

function encodeClose() {
  return new TextEncoder().encode("event: close\ndata: close\n\n");
}
