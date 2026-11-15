/**
 * Owner decisions (product definition v2.7, replaces the "Owner report").
 *
 * - **Accept** puts a recommendation into the agronomist's own plan. It no longer reaches the owner.
 * - **Ask the owner** is a separate, deliberate action for items that need the owner's approval (money, seed, a
 *   rotation change). After the 8 s Undo window it becomes a Decision: a card with a thread.
 * - The owner answers **Approve / Not now / Ask…**; the agronomist replies in the same thread.
 *
 * API (all under /api/w/:ws unless noted):
 *   POST /recommendations/:id/ask-owner        body AskOwnerBody     → the recommendation view (with undoUntil)
 *   POST /recommendations/:id/undo             (existing)            cancels ask-owner within 8 s, like accept
 *   GET  /decisions?state=waiting|question|decided|all               → DecisionList
 *   POST /decisions/:id/answer                 body AnswerBody       → Decision        (Owner)
 *   POST /decisions/:id/replies                body { text }         → Decision        (Owner, Agronomist)
 *   POST /decisions/:id/reply-draft            body {}               → { draft: string; language: "en" | "uk" }
 *   POST /decisions/:id/republish              body {}               → Decision        (the advice changed since asked)
 *   Report links (unchanged CRUD at /report-links) open the owner view without an account:
 *   GET  /api/r/:token                                               → PublicDecisions
 *   POST /api/r/:token/decisions/:id/answer    body AnswerBody       → Decision
 */

export type Localised = { en: string; uk: string };

export type DecisionAnswer = "approve" | "not_now" | "question";

/** waiting: no answer yet · question: the owner asked and nobody replied after · approved / not_now: decided. */
export type DecisionState = "waiting" | "question" | "approved" | "not_now";

export interface ThreadEntry {
  id: string;
  /** note: the agronomist's note sent with the ask · answer: the owner's answer · reply: the agronomist's reply. */
  kind: "note" | "answer" | "reply";
  author: { name: string; role: "agronomist" | "owner" };
  answer?: DecisionAnswer;
  text: string | null;
  at: string;
  /** "link": answered through a report link without an account. */
  via?: "user" | "link";
}

export interface Decision {
  id: string;
  recommendationId: string;
  fieldId: string;
  fieldName: string;
  /** Snapshot taken when asked (the owner sees what was asked, not later model changes). */
  title: Localised;
  action: Localised;
  why: Localised;
  deadline: string | null;
  keyNumbers: Array<{ id: string; value: number | string; unit?: string }>;
  askedAt: string;
  askedBy: { name: string };
  state: DecisionState;
  /** The live recommendation differs from the snapshot: the agronomist may republish. */
  changedSinceAsked: boolean;
  thread: ThreadEntry[];
}

export interface DecisionList {
  workspaceName: string;
  /** Language the owner reads in (workspace report language). */
  language: "en" | "uk";
  counts: { waiting: number; question: number; decided: number };
  /** Names of the company's Owners who receive decisions. */
  recipients: string[];
  items: Decision[];
  /** Opaque cursor for the next page (`?cursor=`); null on the last page. `counts` always cover all decisions. */
  nextCursor?: string | null;
}

export interface PublicDecisions {
  workspaceName: string;
  language: "en" | "uk";
  items: Decision[];
}

export interface AskOwnerBody {
  note?: string;
}

export interface AnswerBody {
  answer: DecisionAnswer;
  text?: string;
}
