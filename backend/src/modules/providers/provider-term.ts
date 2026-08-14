const ACADEMIC_TERM_LABEL_PATTERN = /20\d{2}.*20\d{2}.*学期/;

export function formatProviderTermId(providerId: string, termId: unknown) {
  const normalizedProviderId = String(providerId || "")
    .trim()
    .toLowerCase();
  const normalizedTermId = String(termId || "").trim();
  const wtbuMatch = normalizedTermId.match(/^(\d{2})([23])$/);

  if (normalizedProviderId !== "wtbu" || !wtbuMatch) {
    return "";
  }

  const yearStart = 2000 + Number(wtbuMatch[1]);
  const semester = Number(wtbuMatch[2]) - 1;

  return `${yearStart}-${yearStart + 1}学年第${semester}学期`;
}

export function normalizeProviderTermRecord(providerId: string, term: unknown) {
  if (!term || typeof term !== "object" || Array.isArray(term)) {
    return term;
  }

  const record = term as Record<string, unknown>;
  const id = String(record.id || "").trim();
  const formattedLabel = formatProviderTermId(providerId, id);
  const currentLabel = String(
    record.label || record.title || record.name || "",
  ).trim();

  if (!formattedLabel || ACADEMIC_TERM_LABEL_PATTERN.test(currentLabel)) {
    return term;
  }

  return {
    ...record,
    id,
    label: formattedLabel,
    title: formattedLabel,
  };
}

export function mergeProviderTerms(
  providerId: string,
  termSources: unknown[][],
  fallbackTermIds: Array<string | null | undefined> = [],
) {
  const terms = new Map<string, unknown>();

  for (const source of termSources) {
    for (const term of Array.isArray(source) ? source : []) {
      const normalizedTerm = normalizeProviderTermRecord(providerId, term);

      if (
        !normalizedTerm ||
        typeof normalizedTerm !== "object" ||
        Array.isArray(normalizedTerm)
      ) {
        continue;
      }

      const id = String(
        (normalizedTerm as Record<string, unknown>).id || "",
      ).trim();

      if (id && !terms.has(id)) {
        terms.set(id, normalizedTerm);
      }
    }
  }

  for (const fallbackTermId of fallbackTermIds) {
    const id = String(fallbackTermId || "").trim();

    if (!id || terms.has(id)) {
      continue;
    }

    terms.set(
      id,
      normalizeProviderTermRecord(providerId, { id, label: id, title: id }),
    );
  }

  return [...terms.values()];
}
