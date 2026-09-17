/**
 * Detect assistant text that looks like a JSON object/array still being typed.
 * Used so capture does not freeze a mid-stream `{` as a finished Coordinator plan.
 */
export function looksLikeIncompleteJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
      continue;
    }
    try {
      JSON.parse(candidate);
      return false;
    } catch {
      // Keep checking other candidates; incomplete if none parse.
    }
  }

  const primary = candidates[0] ?? trimmed;
  return primary.startsWith('{') || primary.startsWith('[');
}
