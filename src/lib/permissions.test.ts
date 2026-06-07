import { describe, it, expect } from "vitest";
import { can, moduleSupportsAction, actionsForModule, MODULES } from "@/lib/permissions";

describe("permissions", () => {
  it("can() reads the matrix safely", () => {
    expect(can({ sales: { view: true } }, "sales", "view")).toBe(true);
    expect(can({ sales: { view: true } }, "sales", "delete")).toBe(false);
    expect(can(null, "sales", "view")).toBe(false);
    expect(can(undefined, "sales", "view")).toBe(false);
    expect(can({}, "sales", "view")).toBe(false);
  });

  it("registers the returns and audit modules", () => {
    expect(MODULES).toContain("returns");
    expect(MODULES).toContain("audit");
  });

  it("restricts extra actions to the right modules", () => {
    expect(moduleSupportsAction("payroll", "post")).toBe(true);
    expect(moduleSupportsAction("dashboard", "post")).toBe(false);
    expect(actionsForModule("dashboard")).toEqual(["view", "create", "edit", "delete"]);
  });
});
