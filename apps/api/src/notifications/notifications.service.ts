import { Injectable } from "@nestjs/common";
import { EventKeys } from "@terrasight/shared";
import { PrismaService } from "../db/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { eventRow } from "../messaging/outbox.js";
import { OutboxService } from "../messaging/outbox.service.js";
import type { Member, NotificationDraft } from "./plan.js";

type Tx = Prisma.TransactionClient;
const LIMIT = 30;

/** In-app notifications (RFC §15.4, L-06): rows per recipient plus a live hint on the user's SSE topic. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async members(workspaceId: string, tx: Pick<Tx, "membership"> = this.prisma.system): Promise<Member[]> {
    return tx.membership.findMany({ where: { workspaceId }, select: { userId: true, role: true } });
  }

  /** Inserts the drafts and queues one event per recipient (in the caller's transaction). */
  async create(
    tx: Pick<Tx, "notification" | "outbox">,
    workspaceId: string,
    drafts: NotificationDraft[],
  ): Promise<void> {
    if (!drafts.length) return;
    await tx.notification.createMany({
      data: drafts.map((d) => ({
        workspaceId,
        userId: d.userId,
        kind: d.kind,
        payload: d.payload as Prisma.InputJsonValue,
      })),
    });
    await this.outbox.add(
      tx,
      [...new Set(drafts.map((d) => d.userId))].map((userId) =>
        eventRow(EventKeys.notifications(workspaceId, userId), "notification.created", workspaceId, {}),
      ),
    );
  }

  async list(workspaceId: string, userId: string, unreadOnly: boolean) {
    const where = { workspaceId, userId };
    const [items, unread] = await Promise.all([
      this.prisma.db.notification.findMany({
        where: { ...where, ...(unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
      }),
      this.prisma.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        payload: n.payload,
        createdAt: n.createdAt,
        readAt: n.readAt,
      })),
    };
  }

  /** Marks the given notifications (or all) of this user as read. */
  async markRead(workspaceId: string, userId: string, ids?: string[]) {
    const r = await this.prisma.db.notification.updateMany({
      where: { workspaceId, userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }
}
