// @ts-nocheck
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockdownRow } from "./fixtures";

const state = vi.hoisted(() => ({
  loaderData: undefined as unknown,
  // webSession is provisioned off the critical path via useQuery(webSessionQuery())
  // by the authed layout and dashboard (AP-256).
  webSession: { data: null, error: null } as unknown,
  parentLoaderData: { user: { email: "user@example.com" }, isOperator: false } as unknown,
  parentRouteContext: {} as unknown,
  params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" },
  search: {} as Record<string, unknown>,
  auth: { user: { email: "user@example.com" }, accessToken: "workos-token", role: "admin" } as {
    user: { email: string } | null;
    accessToken: string;
    role?: string;
    roles?: string[];
  },
  apiFetchOrEmpty: vi.fn(),
  liftLockdownFn: vi.fn(),
  setLockdownFn: vi.fn(),
  invalidate: vi.fn(),
  ensureQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  signInUrl: "https://workos.example.test/sign-in",
  signOut: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <TConfig extends Record<string, unknown>>(config: TConfig) => ({
      ...config,
      useLoaderData: () => state.loaderData,
      useRouteContext: () => state.parentRouteContext,
      useParams: () => state.params,
      useSearch: () => state.search,
    }),
  Link: ({ children }: { children: ReactNode }) => <a href="/mock-link">{children}</a>,
  Outlet: () => <div data-testid="outlet" />,
  redirect: (input: unknown) => ({ redirected: true, ...((input as Record<string, unknown>) ?? {}) }),
  useLoaderData: () => state.parentLoaderData,
  useRouteContext: () => state.parentRouteContext,
  useRouter: () => ({ invalidate: state.invalidate }),
  useNavigate: () => vi.fn(),
}));

const emptyListEnvelope = {
  data: { items: [], page_info: { next_cursor: null, has_more: false } },
  empty: true,
  error: null,
};

vi.mock("@tanstack/react-query", () => ({
  // Migrated routes read through useSuspenseQuery; mirror the loader-data
  // harness so components still render from state.loaderData. The artifact
  // detail page also reads access-link/revision lists; return empty envelopes
  // for those keys so the single state.loaderData drives the artifact read.
  useSuspenseQuery: (options?: { queryKey?: readonly unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "artifact-access-links" || key === "artifact-revisions") {
      return { data: emptyListEnvelope };
    }
    return { data: state.loaderData };
  },
  // Non-blocking reads: web-session provisioning + deferred artifact revisions.
  useQuery: (options?: { queryKey?: readonly unknown[] }) => {
    const key = options?.queryKey?.[0];
    if (key === "web-session") return { data: state.webSession };
    if (key === "artifact-revisions") return { data: emptyListEnvelope };
    return { data: state.loaderData };
  },
  useQueryClient: () => ({
    ensureQueryData: state.ensureQueryData,
    invalidateQueries: state.invalidateQueries,
  }),
  queryOptions: (options: unknown) => options,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (handler: (input?: unknown) => unknown) => (input?: unknown) => handler(input),
    };
    return builder;
  },
  getGlobalStartContext: () => ({
    auth: () =>
      state.auth.user
        ? {
            ...state.auth,
            sessionId: "session_1",
            claims: {
              role: state.auth.role,
              roles: state.auth.roles,
            },
          }
        : { user: null },
  }),
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: () => state.auth,
  getAuthkit: () => ({
    createSignIn: (_screenHint?: unknown, input?: { returnPathname?: string }) => ({
      url: input?.returnPathname ? `${state.signInUrl}?return=${input.returnPathname}` : state.signInUrl,
    }),
    signOut: (sessionId: string) => {
      state.signOut(sessionId);
      return { logoutUrl: "https://workos.example.test/sign-out" };
    },
  }),
  getSignInUrl: (input?: { data?: { returnPathname?: string } }) =>
    input?.data?.returnPathname ? `${state.signInUrl}?return=${input.data.returnPathname}` : state.signInUrl,
  signOut: () => state.signOut(),
  handleCallbackRoute: (input: unknown) => () => new Response(JSON.stringify(input)),
}));

vi.mock("../src/server/api-client", () => ({
  apiFetchOrEmpty: (...args: unknown[]) => state.apiFetchOrEmpty(...args),
}));

vi.mock("../src/rpc/web-mutations", () => ({
  liftLockdownFn: (...args: unknown[]) => state.liftLockdownFn(...args),
  setLockdownFn: (...args: unknown[]) => state.setLockdownFn(...args),
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => ({
    WEB_BASE_URL: "https://app.agent-paste.sh",
    API_BASE_URL: "https://api.agent-paste.sh",
    WORKOS_REDIRECT_URI: "https://app.agent-paste.sh/api/auth/callback",
  }),
}));

// Loaders migrated to TanStack Query read context.queryClient.ensureQueryData.
const queryContext = () => ({ context: { queryClient: { ensureQueryData: state.ensureQueryData } } });

describe("web routes", () => {
  beforeEach(() => {
    state.loaderData = undefined;
    state.webSession = { data: null, error: null };
    state.parentLoaderData = { user: { email: "user@example.com" }, isOperator: false };
    state.parentRouteContext = {};
    state.params = { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" };
    state.search = {};
    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token", role: "admin" };
    state.apiFetchOrEmpty.mockReset();
    state.liftLockdownFn.mockReset();
    state.setLockdownFn.mockReset();
    state.invalidate.mockReset();
    state.ensureQueryData.mockReset();
    // Faithfully run the query's own fetcher so loader-level assertions on the
    // underlying API calls keep working.
    state.ensureQueryData.mockImplementation((options: { queryFn?: () => unknown } | undefined) =>
      Promise.resolve(options?.queryFn ? options.queryFn() : state.loaderData),
    );
    state.invalidateQueries.mockReset();
    state.signOut.mockReset();
  });

  it("resolves the authenticated layout identity without blocking on the API", async () => {
    const authed = await import("../src/routes/_authed");
    const loader = authed.Route.loader as (input: {
      location: { pathname: string; searchStr: string };
    }) => Promise<unknown>;

    state.auth = { user: null, accessToken: "" };
    await expect(loader({ location: { pathname: "/claim", searchStr: "" } })).resolves.toMatchObject({
      guest: true,
    });

    await expect(loader({ location: { pathname: "/settings", searchStr: "" } })).resolves.toMatchObject({
      redirectTo: "https://app.agent-paste.sh/api/auth/sign-in?returnPathname=%2Fsettings",
    });
    await expect(loader({ location: { pathname: "/audit", searchStr: "?request_id=req_1" } })).resolves.toMatchObject({
      redirectTo: "https://app.agent-paste.sh/api/auth/sign-in?returnPathname=%2Faudit%3Frequest_id%3Dreq_1",
    });

    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token", role: "admin" };
    await expect(loader({ location: { pathname: "/dashboard", searchStr: "" } })).resolves.toMatchObject({
      user: { email: "user@example.com" },
      isOperator: true,
    });
    // The DB-writing /v1/auth/web/callback is no longer on the navigation
    // critical path; the layout fires it after paint via webSessionQuery (AP-256).
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalledWith(
      "/v1/auth/web/callback",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("provisions the workspace off the critical path via web-session and surfaces the first-run key", async () => {
    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token", role: "admin" };
    const { provisionWebMemberSessionFn } = await import("../src/rpc/web-loaders");
    state.apiFetchOrEmpty.mockResolvedValueOnce({
      data: {
        workspace: workspace().workspace,
        workspace_member: workspace().workspace_member,
        scopes: ["admin"],
        default_api_key: { api_key: apiKeyRow(), secret: "ap_pk_preview_first_secret" },
      },
      empty: false,
      error: null,
    });
    await expect((provisionWebMemberSessionFn as (input?: unknown) => Promise<unknown>)()).resolves.toMatchObject({
      data: { default_api_key: { secret: "ap_pk_preview_first_secret" } },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/auth/web/callback", {
      method: "POST",
      accessToken: "workos-token",
    });
  });

  it("loads dashboard data and renders populated dashboard state", async () => {
    state.apiFetchOrEmpty
      .mockResolvedValueOnce({ data: workspace(), empty: false, error: null })
      .mockResolvedValueOnce({
        data: { items: [artifactRow()], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [auditRow()], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      });
    const { Route } = await import("../src/routes/_authed.dashboard");

    await expect((Route.loader as (input: unknown) => Promise<unknown>)(queryContext())).resolves.toMatchObject({
      workspace: { data: { workspace: { name: "Demo" } } },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/web/workspace", { accessToken: "workos-token" });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalledWith(
      "/v1/auth/web/callback",
      expect.objectContaining({ method: "POST" }),
    );

    state.loaderData = {
      workspace: { data: { ...workspace(), default_key_first_run: true }, empty: false, error: null },
      artifacts: {
        data: { items: [artifactRow()], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      },
      audit: {
        data: { items: [auditRow()], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      },
    };
    state.webSession = {
      data: {
        default_api_key: { secret: "ap_pk_preview_first_secret" },
      },
      error: null,
    };
    render(<Route.component />);
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Your default API key")).toBeInTheDocument();
    expect(screen.getByText("Reveal secret")).toBeInTheDocument();
    expect(screen.getByText("artifact.published")).toBeInTheDocument();
  });

  it("renders dashboard empty and error states", async () => {
    const { Route } = await import("../src/routes/_authed.dashboard");

    state.loaderData = {
      workspace: { data: null, empty: true, error: null },
      artifacts: { data: null, empty: true, error: null },
      audit: { data: null, empty: true, error: null },
    };
    const empty = render(<Route.component />);
    expect(screen.getByText("Nothing on record yet.")).toBeInTheDocument();
    empty.unmount();

    state.loaderData = {
      workspace: { data: null, empty: false, error: { message: "boom", requestId: "req_1" } },
      artifacts: null,
      audit: null,
    };
    render(<Route.component />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your workspace");
  });

  it("loads and renders artifact list, detail, audit, keys, settings, access-links, admin, and health routes", async () => {
    const artifacts = await import("../src/routes/_authed.artifacts.index");
    const artifactDetail = await import("../src/routes/_authed.artifacts.$artifactId");
    const audit = await import("../src/routes/_authed.audit");
    const keys = await import("../src/routes/_authed.keys");
    const settings = await import("../src/routes/_authed.settings");
    const accessLinks = await import("../src/routes/_authed.access-links");
    const admin = await import("../src/routes/_authed.admin");
    const health = await import("../src/routes/healthz");
    const { ToastProvider } = await import("../src/components/ui/ToastProvider");

    state.apiFetchOrEmpty.mockResolvedValue({
      data: { items: [artifactRow()], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    });
    await (artifacts.Route.loader as (input: unknown) => Promise<unknown>)(queryContext());
    state.loaderData = {
      data: { items: [artifactRow()], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    };
    let view = render(<artifacts.Route.component />);
    expect(screen.getByText("Artifact One")).toBeInTheDocument();
    view.unmount();

    // The migrated loader ensureQueryData's three queries (artifact, access
    // links, revisions); feed their fetchers in array order.
    state.apiFetchOrEmpty
      .mockResolvedValueOnce({ data: artifactDetailRow(), empty: false, error: null })
      .mockResolvedValueOnce({
        data: { items: [], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      })
      .mockResolvedValueOnce({
        data: { artifact_id: state.params.artifactId, items: [], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      });
    state.loaderData = { data: artifactDetailRow(), empty: false, error: null };
    await (artifactDetail.Route.loader as (input: unknown) => Promise<unknown>)({
      ...queryContext(),
      params: { artifactId: state.params.artifactId },
    });
    view = render(
      <ToastProvider>
        <artifactDetail.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("Latest revision")).toBeInTheDocument();
    view.unmount();

    state.search = { request_id: "req_missing" };
    state.loaderData = {
      data: { items: [auditRow()], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    };
    expect(
      (audit.Route.validateSearch as (input: Record<string, unknown>) => unknown)({ request_id: "req_missing" }),
    ).toEqual({
      request_id: "req_missing",
    });
    view = render(<audit.Route.component />);
    expect(screen.getByText(/No recent event matches/)).toBeInTheDocument();
    view.unmount();

    state.loaderData = {
      data: { items: [apiKeyRow()], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    };
    view = render(
      <ToastProvider>
        <keys.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("API Keys")).toBeInTheDocument();
    view.unmount();

    state.loaderData = { data: settingsRow(), empty: false, error: null };
    view = render(
      <ToastProvider>
        <settings.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("Usage policy")).toBeInTheDocument();
    view.unmount();

    state.loaderData = {
      data: { items: [], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    };
    view = render(
      <ToastProvider>
        <accessLinks.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("Access Links")).toBeInTheDocument();
    view.unmount();

    state.apiFetchOrEmpty
      .mockResolvedValueOnce({
        data: { items: [lockdownRow("phishing_report")], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              time: "2026-01-01T00:00:00.000Z",
              actor: "platform:operator@example.com",
              actor_type: "platform",
              action: "platform.lockdown.set",
              target: "workspace:w_1",
              target_type: "workspace",
              workspace_id: "w_1",
              change_summary: "Platform lockdown set on workspace (reason: phishing_report)",
              request_id: "req_1",
            },
          ],
          page_info: { next_cursor: null, has_more: false },
        },
        empty: false,
        error: null,
      });
    await expect(
      (admin.Route.loader as (input: unknown) => Promise<unknown>)({
        ...queryContext(),
        location: { search: { focus: "security" } },
      }),
    ).resolves.toMatchObject({
      eventSearch: { focus: "security" },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/web/admin/lockdowns", {
      accessToken: "workos-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/web/admin/events?focus=security", {
      accessToken: "workos-token",
    });
    state.loaderData = {
      allowed: true,
      lockdownPrefill: {},
      lockdowns: {
        data: { items: [lockdownRow("phishing_report")], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      },
      events: {
        data: {
          items: [
            {
              id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
              time: "2026-01-01T00:00:00.000Z",
              actor: "platform:operator@example.com",
              actor_type: "platform",
              action: "platform.lockdown.set",
              target: "workspace:w_1",
              target_type: "workspace",
              workspace_id: "w_1",
              change_summary: "",
              request_id: "req_1",
            },
          ],
          page_info: { next_cursor: null, has_more: false },
        },
        empty: false,
        error: null,
      },
      eventSearch: { focus: "security" },
    };
    view = render(
      <ToastProvider>
        <admin.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("phishing_report")).toBeInTheDocument();
    expect(screen.getByText("Platform events")).toBeInTheDocument();
    expect(screen.getByText("platform.lockdown.set")).toBeInTheDocument();
    view.unmount();

    await expect((health.Route.loader as () => Promise<unknown>)()).resolves.toEqual({ ok: true, app: "web" });
    state.loaderData = { ok: true, app: "web" };
    render(<health.Route.component />);
    expect(screen.getByText(/"app": "web"/)).toBeInTheDocument();
  });

  it("redirects /admin for authenticated users without the WorkOS admin role", async () => {
    const admin = await import("../src/routes/_authed.admin");

    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token", role: "member" };

    await expect(
      (admin.Route.loader as (input: unknown) => Promise<unknown>)({
        ...queryContext(),
        location: { search: {} },
      }),
    ).rejects.toMatchObject({
      redirected: true,
      to: "/dashboard",
    });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalledWith("/v1/web/admin/lockdowns", expect.anything());
  });

  it("allows /admin when WorkOS roles includes admin", async () => {
    const admin = await import("../src/routes/_authed.admin");

    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token", roles: ["member", "admin"] };
    state.apiFetchOrEmpty
      .mockResolvedValueOnce({
        data: { items: [], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      })
      .mockResolvedValueOnce({
        data: { items: [], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      });

    await expect(
      (admin.Route.loader as (input: unknown) => Promise<unknown>)({
        ...queryContext(),
        location: { search: {} },
      }),
    ).resolves.toMatchObject({
      eventSearch: {},
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/web/admin/lockdowns", {
      accessToken: "workos-token",
    });
    expect(state.apiFetchOrEmpty).toHaveBeenCalledWith("/v1/web/admin/events", {
      accessToken: "workos-token",
    });
  });

  it("exposes per-route document titles and descriptions", async () => {
    const dashboard = await import("../src/routes/_authed.dashboard");
    const artifactDetail = await import("../src/routes/_authed.artifacts.$artifactId");
    const artifactsIndex = await import("../src/routes/_authed.artifacts.index");
    const accessLinks = await import("../src/routes/_authed.access-links");
    const keys = await import("../src/routes/_authed.keys");
    const audit = await import("../src/routes/_authed.audit");
    const settings = await import("../src/routes/_authed.settings");
    const admin = await import("../src/routes/_authed.admin");
    const claim = await import("../src/routes/_authed.claim");
    const index = await import("../src/routes/index");
    const accessLink = await import("../src/routes/al.$publicId");
    const rootMatches = [{ routeId: "__root__", loaderData: { webBaseUrl: "https://app.agent-paste.sh" } }];
    const headCtx = { matches: rootMatches };

    expect(
      (dashboard.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(
        headCtx,
      ),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Overview | agent-paste" },
        { name: "description", content: "Overview of recent artifacts, audit events, and usage policy." },
      ]),
    });

    expect(
      (artifactsIndex.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(
        headCtx,
      ),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Artifacts | agent-paste" },
        { name: "description", content: "Everything published from this workspace." },
      ]),
    });

    expect(
      (accessLinks.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(
        headCtx,
      ),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Access Links | agent-paste" },
        { name: "description", content: "Short-lived URLs that reveal a single artifact to a recipient." },
      ]),
    });

    expect(
      (keys.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "API Keys | agent-paste" },
        { name: "description", content: "Manage API keys for CI, headless use, and workspace automation." },
      ]),
    });

    expect(
      (audit.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Audit Log | agent-paste" },
        { name: "description", content: "Every meaningful action in this workspace." },
      ]),
    });

    expect(
      (settings.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Workspace Settings | agent-paste" },
        { name: "description", content: "Workspace name, retention, and usage caps." },
      ]),
    });

    expect(
      (claim.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Claim Ephemeral Workspace | agent-paste" },
        {
          name: "description",
          content: "Redeem a one-time Claim Token to keep agent-published content in your workspace.",
        },
      ]),
    });

    expect(
      (admin.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Operator | agent-paste" },
        {
          name: "description",
          content: "Platform lockdowns and cross-workspace security or lifecycle event browsing.",
        },
      ]),
    });

    expect(
      (
        artifactDetail.Route.head as (ctx: {
          loaderData: { artifact?: { data?: { title?: string } } };
          params: { artifactId: string };
          matches: Array<{ routeId: string; loaderData?: unknown }>;
        }) => unknown
      )({
        loaderData: { artifact: { data: { title: "Artifact One" } } },
        params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9" },
        matches: rootMatches,
      }),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Artifact One | agent-paste" },
        { name: "description", content: "Artifact details for Artifact One." },
      ]),
    });

    expect(
      (index.Route.head as (ctx: { matches: Array<{ routeId: string; loaderData?: unknown }> }) => unknown)(headCtx),
    ).toEqual({
      meta: expect.arrayContaining([
        { title: "Sign in | agent-paste" },
        { property: "og:site_name", content: "agent-paste.sh" },
        { property: "og:url", content: "https://app.agent-paste.sh/" },
        { property: "og:image", content: "https://app.agent-paste.sh/agent-paste-social.svg" },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    });

    expect(
      (
        accessLink.Route.head as (ctx: {
          params: { publicId: string };
          matches: Array<{ routeId: string; loaderData?: unknown }>;
        }) => unknown
      )({
        params: { publicId: "pub_1" },
        matches: rootMatches,
      }),
    ).toEqual({
      meta: expect.arrayContaining([
        { name: "referrer", content: "no-referrer" },
        { title: "Access Link | agent-paste" },
        { property: "og:url", content: "https://app.agent-paste.sh/al/pub_1" },
        { name: "robots", content: "noindex,nofollow" },
      ]),
    });
  });

  it("handles root and auth route server handlers", async () => {
    const root = await import("../src/routes/index");
    const signIn = await import("../src/routes/api/auth/sign-in");
    const signOut = await import("../src/routes/api/auth/sign-out");
    const callback = await import("../src/routes/api/auth/callback");

    expect(
      (root.Route.validateSearch as (input: Record<string, unknown>) => unknown)({ auth_error: "failed" }),
    ).toEqual({
      auth_error: "failed",
    });
    await expect(
      (root.Route.loader as (input: { location: { search: Record<string, unknown> } }) => Promise<unknown>)({
        location: { search: { auth_error: "failed" } },
      }),
    ).resolves.toEqual({ auth_error: "failed" });
    state.loaderData = { auth_error: "failed" };
    const view = render(<root.Route.component />);
    expect(screen.getByText("Sign in failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zaks.io, LLC" })).toHaveAttribute("href", "https://zaks.io");
    view.unmount();

    const response = await signIn.Route.server.handlers.GET({
      request: new Request("https://app.test/api/auth/sign-in?returnPathname=/dashboard"),
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://workos.example.test/sign-in?return=/dashboard");

    const signOutResponse = await signOut.Route.server.handlers.POST({
      request: new Request("https://app.test/api/auth/sign-out"),
    });
    expect(signOutResponse.status).toBe(303);
    expect(signOutResponse.headers.get("location")).toBe("https://workos.example.test/sign-out");
    expect(state.signOut).toHaveBeenCalledWith("session_1");
    const callbackResponse = await callback.Route.server.handlers.GET({
      request: new Request("https://app.test/api/auth/callback"),
    });
    expect(callbackResponse).toBeInstanceOf(Response);
    await expect(callbackResponse.json()).resolves.toEqual({
      errorRedirectUrl: "/?auth_error=callback_failed",
    });
  });
});

function workspace() {
  return {
    workspace: { id: "00000000-0000-4000-8000-000000000000", name: "Demo", created_at: "2026-01-01T00:00:00.000Z" },
    workspace_member: {
      id: "mem_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
      workspace_id: "00000000-0000-4000-8000-000000000000",
      email: "user@example.com",
      scopes: ["admin"],
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    usage_policy: {
      file_size_cap_bytes: 10,
      artifact_size_cap_bytes: 100,
      bundle_size_cap_bytes: 100,
      bundles_enabled: true,
      file_count_cap: 100,
      actor_rate_limit_per_minute: 60,
      workspace_burst_cap_per_minute: 300,
      upload_session_ttl_seconds: 86_400,
      default_ttl_seconds: 2_592_000,
      min_ttl_seconds: 86_400,
      max_ttl_seconds: 7_776_000,
      live_artifacts_cap: 50,
      live_update_enabled: false,
    },
    default_key_first_run: false,
  };
}

function artifactRow() {
  return {
    id: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    title: "Artifact One",
    status: "Published",
    latest_revision_id: "rev_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    pinned: true,
    lockdown: false,
    last_published_at: "2026-01-01T00:00:00.000Z",
    auto_delete_at: "2026-02-01T00:00:00.000Z",
  };
}

function artifactDetailRow() {
  return { ...artifactRow(), entrypoint: "index.html", file_count: 1, size_bytes: 1024 };
}

function auditRow() {
  return {
    id: "evt_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    time: "2026-01-01T00:00:00.000Z",
    actor: "member:user",
    action: "artifact.published",
    target: "artifact:art_1",
    change_summary: "published",
    request_id: "req_1",
  };
}

function apiKeyRow() {
  return {
    id: "key_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9",
    workspace_id: "00000000-0000-4000-8000-000000000000",
    name: "Default",
    public_id: "0123456789ABCDEF",
    scopes: ["publish", "read"],
    revoked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_used_at: null,
    expires_at: null,
    revoked: false,
  };
}

function settingsRow() {
  return {
    workspace_name: "Demo",
    auto_deletion_days: 30,
    auto_deletion_bounds: { min_days: 1, max_days: 90 },
    usage_policy: { artifacts_per_day: 100, bytes_per_day: 1000 },
  };
}
