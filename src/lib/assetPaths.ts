const BUILD_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function getBasePath(): string {
  if (BUILD_BASE_PATH) {
    return BUILD_BASE_PATH;
  }

  // Fallback for GitHub Pages project sites if build-time env injection is missing.
  if (typeof window !== "undefined" && window.location.hostname.endsWith("github.io")) {
    const firstSegment = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    return firstSegment ? `/${firstSegment}` : "";
  }

  return "";
}

export function withBasePath(path: string): string {
  const basePath = getBasePath();

  if (!path) {
    return basePath || "/";
  }

  if (/^(?:[a-z]+:)?\/\//i.test(path)) {
    return path;
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  return basePath ? `${basePath}${normalized}` : normalized;
}
