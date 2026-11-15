/**
 * The Ask contract: `/assistant?ask=<encoded question>&field=<fieldId>` opens the assistant with that field as context
 * and the question in the composer, focused and NOT sent. The parameters are removed from the address afterwards.
 * Other screens may build the same URL by hand; the format must stay exactly this one.
 */
export function askHref(question: string, opts: { fieldId?: string } = {}): string {
  const q = question.trim().slice(0, 2000);
  const field = opts.fieldId ? `&field=${encodeURIComponent(opts.fieldId)}` : "";
  return `/assistant?ask=${encodeURIComponent(q)}${field}`;
}
