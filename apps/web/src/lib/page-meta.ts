/** Meta tag shape accepted by TanStack Router `head().meta`. */
export type MetaTag = { title: string } | { name: string; content: string } | { property: string; content: string };

export const SITE_NAME = "agent-paste";
export const TITLE_SUFFIX = ` | ${SITE_NAME}`;
export const DEFAULT_DESCRIPTION =
  "Publish and manage artifacts from your agents. View workspace activity, API keys, and settings in the dashboard.";

export type PageMetaOptions = {
  title: string;
  description?: string;
  /** Path (e.g. `/dashboard`) or absolute URL for og:url */
  path?: string;
  baseUrl?: string;
  /** Emit Open Graph and Twitter card tags */
  social?: boolean;
  noIndex?: boolean;
  ogType?: string;
};

export function formatPageTitle(title: string): string {
  if (title === SITE_NAME || title.endsWith(TITLE_SUFFIX)) return title;
  return `${title}${TITLE_SUFFIX}`;
}

export function resolvePageUrl(baseUrl: string | undefined, path?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (baseUrl) {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
  if (typeof window !== "undefined") {
    try {
      return new URL(path, window.location.origin).href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function webBaseUrlFromMatches(
  matches: ReadonlyArray<{ routeId?: string; loaderData?: unknown }>,
): string | undefined {
  const root = matches.find((match) => match.routeId === "__root__");
  const data = root?.loaderData as { webBaseUrl?: string } | undefined;
  return typeof data?.webBaseUrl === "string" ? data.webBaseUrl : undefined;
}

export function buildPageMeta(options: PageMetaOptions): { meta: MetaTag[] } {
  const title = formatPageTitle(options.title);
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const url = resolvePageUrl(options.baseUrl, options.path);

  const meta: MetaTag[] = [{ title }, { name: "description", content: description }];

  if (options.noIndex) {
    meta.push({ name: "robots", content: "noindex,nofollow" });
  }

  if (options.social) {
    meta.push(
      { property: "og:type", content: options.ogType ?? "website" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    );
    if (url) {
      meta.push({ property: "og:url", content: url });
    }
  }

  return { meta };
}

export function dashboardPageMeta(
  title: string,
  description: string,
  path: string,
  matches: ReadonlyArray<{ routeId?: string; loaderData?: unknown }>,
): { meta: MetaTag[] } {
  const baseUrl = webBaseUrlFromMatches(matches);
  return buildPageMeta({
    title,
    description,
    path,
    ...(baseUrl ? { baseUrl } : {}),
  });
}

export function publicPageMeta(
  options: Omit<PageMetaOptions, "baseUrl"> & {
    matches: ReadonlyArray<{ routeId?: string; loaderData?: unknown }>;
  },
): { meta: MetaTag[] } {
  const { matches, ...rest } = options;
  const baseUrl = webBaseUrlFromMatches(matches);
  return buildPageMeta({
    ...rest,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
