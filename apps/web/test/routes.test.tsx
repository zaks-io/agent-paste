// @ts-nocheck
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lockdownRow } from "./fixtures";

const state = vi.hoisted(() => ({
  loaderData: undefined as unknown,
  parentRouteContext: { apiSession: { data: null, error: null } } as unknown,
  params: { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" },
  search: {} as Record<string, unknown>,
  auth: { user: { email: "user@example.com" }, accessToken: "workos-token" } as {
    user: { email: string } | null;
    accessToken: string;
  },
  apiFetchOrEmpty: vi.fn(),
  liftLockdownFn: vi.fn(),
  setLockdownFn: vi.fn(),
  invalidate: vi.fn(),
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
  useRouteContext: () => state.parentRouteContext,
  useRouter: () => ({ invalidate: state.invalidate }),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (handler: (input?: unknown) => unknown) => (input?: unknown) => handler(input),
    };
    return builder;
  },
}));

vi.mock("@workos/authkit-tanstack-react-start", () => ({
  getAuth: () => state.auth,
  getSignInUrl: (input?: { data?: { returnPathname?: string } }) =>
    input?.data?.returnPathname ? `${state.signInUrl}?return=${input.data.returnPathname}` : state.signInUrl,
  signOut: () => state.signOut(),
  handleCallbackRoute: (input: unknown) => () => new Response(JSON.stringify(input)),
}));

vi.mock("../src/server/api-client", () => ({
  apiFetchOrEmpty: (...args: unknown[]) => state.apiFetchOrEmpty(...args),
}));

vi.mock("../src/server/web-mutations", () => ({
  liftLockdownFn: (...args: unknown[]) => state.liftLockdownFn(...args),
  setLockdownFn: (...args: unknown[]) => state.setLockdownFn(...args),
}));

vi.mock("../src/server/runtime", () => ({
  getWebEnv: () => ({ OPERATOR_EMAILS: "user@example.com" }),
}));

describe("web routes", () => {
  beforeEach(() => {
    state.loaderData = undefined;
    state.parentRouteContext = { apiSession: { data: null, error: null } };
    state.params = { artifactId: "art_01HZY7Q8X9Y2S3T4V5W6X7Y8Z9", publicId: "pub_1" };
    state.search = {};
    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token" };
    state.apiFetchOrEmpty.mockReset();
    state.liftLockdownFn.mockReset();
    state.setLockdownFn.mockReset();
    state.invalidate.mockReset();
    state.signOut.mockReset();
  });

  it("provisions the authenticated layout before child loaders run", async () => {
    const authed = await import("../src/routes/_authed");

    state.auth = { user: null, accessToken: "" };
    await expect((authed.Route.beforeLoad as () => Promise<unknown>)()).rejects.toMatchObject({
      redirected: true,
      href: "/api/auth/sign-in",
    });
    expect(state.apiFetchOrEmpty).not.toHaveBeenCalled();

    state.auth = { user: { email: "user@example.com" }, accessToken: "workos-token" };
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

    await expect((authed.Route.beforeLoad as () => Promise<unknown>)()).resolves.toMatchObject({
      user: { email: "user@example.com" },
      isOperator: true,
      apiSession: {
        data: {
          default_api_key: { secret: "ap_pk_preview_first_secret" },
        },
      },
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

    await expect((Route.loader as () => Promise<unknown>)()).resolves.toMatchObject({
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
    state.parentRouteContext = {
      apiSession: {
        data: {
          default_api_key: { secret: "ap_pk_preview_first_secret" },
        },
        error: null,
      },
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
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
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
    await (artifacts.Route.loader as () => Promise<unknown>)();
    state.loaderData = {
      data: { items: [artifactRow()], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    };
    let view = render(<artifacts.Route.component />);
    expect(screen.getByText("Artifact One")).toBeInTheDocument();
    view.unmount();

    state.apiFetchOrEmpty.mockResolvedValueOnce({ data: artifactDetailRow(), empty: false, error: null });
    await (artifactDetail.Route.loader as (input: { params: { artifactId: string } }) => Promise<unknown>)({
      params: { artifactId: state.params.artifactId },
    });
    state.loaderData = { data: artifactDetailRow(), empty: false, error: null };
    view = render(<artifactDetail.Route.component />);
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

    view = render(<accessLinks.Route.component />);
    expect(screen.getByText("Access Links")).toBeInTheDocument();
    view.unmount();

    state.apiFetchOrEmpty.mockResolvedValueOnce({
      data: { items: [lockdownRow("phishing_report")], page_info: { next_cursor: null, has_more: false } },
      empty: false,
      error: null,
    });
    await expect((admin.Route.loader as () => Promise<unknown>)()).resolves.toMatchObject({
      lockdowns: { data: { items: [{ reason_code: "phishing_report" }] } },
    });
    expect(state.apiFetchOrEmpty).toHaveBeenLastCalledWith("/v1/web/admin/lockdowns", {
      accessToken: "workos-token",
    });
    state.loaderData = {
      lockdowns: {
        data: { items: [lockdownRow("phishing_report")], page_info: { next_cursor: null, has_more: false } },
        empty: false,
        error: null,
      },
    };
    view = render(
      <ToastProvider>
        <admin.Route.component />
      </ToastProvider>,
    );
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("phishing_report")).toBeInTheDocument();
    view.unmount();

    await expect((health.Route.loader as () => Promise<unknown>)()).resolves.toEqual({ ok: true, app: "web" });
    state.loaderData = { ok: true, app: "web" };
    render(<health.Route.component />);
    expect(screen.getByText(/"app": "web"/)).toBeInTheDocument();
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
    view.unmount();

    const response = await signIn.Route.server.handlers.GET({
      request: new Request("https://app.test/api/auth/sign-in?returnPathname=/dashboard"),
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://workos.example.test/sign-in?return=/dashboard");
    await signOut.Route.server.handlers.POST();
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(callback.Route.server.handlers.GET()).toBeInstanceOf(Response);
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
      file_count_cap: 100,
      actor_rate_limit_per_minute: 60,
      workspace_burst_cap_per_minute: 300,
      upload_session_ttl_seconds: 86_400,
      default_ttl_seconds: 2_592_000,
      min_ttl_seconds: 86_400,
      max_ttl_seconds: 7_776_000,
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
    usage_policy: { artifacts_per_day: 100, bytes_per_day: 1000 },
  };
}
