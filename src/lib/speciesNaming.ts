export function normalizeSpeciesQuery(value: string): string {
  return value.toLowerCase().trim();
}

export function stripTaxonomyPrefix(value: string): string {
  return value.replace(/^[a-z]__/i, "").trim();
}

export function formatSpeciesName(value: string): string {
  return stripTaxonomyPrefix(value);
}

export function speciesNameToSlug(name: string): string {
  const normalized = formatSpeciesName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return normalized || "species";
}
