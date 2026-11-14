import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Envelope, matchesPattern, topicPattern, type StreamTopic } from "@terrasight/shared";
import { Observable, Subject, filter, map, merge, interval, from, concatMap } from "rxjs";
import { BROKER, type Broker } from "../messaging/broker.js";
import { EXCHANGES } from "../messaging/topology.js";

export interface StreamEvent {
  /** SSE event name: the stream topic, or `ping` for heartbeats. */
  type: string;
  data: unknown;
  id?: string;
}

interface Received {
  routingKey: string;
  envelope: Envelope;
}

/** Produces the current state for a topic, sent first when a browser (re)connects (RFC §5.3). */
export type StateProvider = (workspaceId: string, topic: StreamTopic) => Promise<unknown | undefined>;

export const HEARTBEAT_MS = 15_000;

/**
 * Bridges `terrasight.events` to browser streams. Each API instance binds one exclusive queue to the
 * topic exchange and fans events out in memory. Events are hints: on connect the current state comes from
 * PostgreSQL through the registered state providers, then live events follow.
 */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly log = new Logger(EventsService.name);
  private readonly incoming = new Subject<Received>();
  private readonly providers = new Map<string, StateProvider>();

  constructor(@Inject(BROKER) private readonly broker: Broker) {}

  async onModuleInit(): Promise<void> {
    await this.broker.subscribe(EXCHANGES.events, "#", (msg) => {
      try {
        const envelope = Envelope.parse(JSON.parse(msg.content.toString("utf8")));
        this.incoming.next({ routingKey: msg.routingKey, envelope });
      } catch (e) {
        this.log.warn(`Dropped malformed event ${msg.routingKey}: ${(e as Error).message}`);
      }
    });
  }

  /** Feature modules register how to load a topic's current state (e.g. `brief` in EP-04). */
  registerStateProvider(
    kind: "brief" | "analysis" | "field" | "conversation",
    provider: StateProvider,
  ): void {
    this.providers.set(kind, provider);
  }

  /** Exposed for tests and for in-process producers. */
  push(routingKey: string, envelope: Envelope): void {
    this.incoming.next({ routingKey, envelope });
  }

  stream(
    workspaceId: string,
    topics: StreamTopic[],
    heartbeatMs = HEARTBEAT_MS,
    userId?: string,
  ): Observable<StreamEvent> {
    const patterns = topics.map((t) => ({ topic: t, pattern: topicPattern(t, workspaceId, userId) }));

    const initial = from(topics).pipe(
      concatMap(async (topic): Promise<StreamEvent | null> => {
        const kind = topic.split(":")[0] as string;
        const provider = this.providers.get(kind);
        const state = provider ? await provider(workspaceId, topic) : undefined;
        return state === undefined ? null : { type: topic, data: { state } };
      }),
      filter((e): e is StreamEvent => e !== null),
    );

    const live = this.incoming.pipe(
      // Events carry their workspace; never forward another workspace's event.
      filter((r) => r.envelope.workspaceId === workspaceId),
      map((r): StreamEvent | null => {
        const hit = patterns.find((p) => matchesPattern(p.pattern, r.routingKey));
        return hit ? { type: hit.topic, data: r.envelope, id: r.envelope.id } : null;
      }),
      filter((e): e is StreamEvent => e !== null),
    );

    const heartbeat = interval(heartbeatMs).pipe(map((): StreamEvent => ({ type: "ping", data: {} })));

    return merge(initial, live, heartbeat);
  }
}
