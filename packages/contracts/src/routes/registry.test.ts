import { describe, expect, it } from "vitest";
import { routeContractById } from "./registry.js";

describe("routeContractById", () => {
  it("returns the route contract for a known id", () => {
    expect(routeContractById("whoami.get")).toMatchObject({ id: "whoami.get", app: "api" });
  });

  it("throws for an unknown route id", () => {
    expect(() => routeContractById("missing.route" as never)).toThrow("Unknown route contract: missing.route");
  });
});
