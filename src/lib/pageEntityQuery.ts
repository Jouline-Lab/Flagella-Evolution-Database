/** Query key for species/gene identifiers in page URLs. */
export const PAGE_ENTITY_ID_QUERY = "id";

export function speciesPageHref(entityId: string): string {
  return `/species?${PAGE_ENTITY_ID_QUERY}=${encodeURIComponent(entityId)}`;
}

export function genePageHref(entityId: string): string {
  return `/genes?${PAGE_ENTITY_ID_QUERY}=${encodeURIComponent(entityId)}`;
}
