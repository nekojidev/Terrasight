/** Legacy staff report shapes (the staff Reports page is replaced by decisions). */
type Localised = { en: string; uk: string };
export interface ReportItem {
  id: string;
  fieldName: string;
  text: {
    title: Localised;
    action: Localised;
    why: Localised;
    scout: Localised | null;
    deadline: string | null;
  };
  note: string | null;
  changedSinceAccepted: boolean;
  latestAnswer: { answer: "done" | "not_yet" | "question"; text: string | null; via: "user" | "link"; at: string } | null;
  replies: Array<{ text: string; at: string }>;
}
export interface ReportView {
  workspaceName: string;
  language: "en" | "uk";
  counts: { items: number; done: number; questions: number };
  fields: Array<{ fieldId: string; fieldName: string; items: ReportItem[] }>;
}

