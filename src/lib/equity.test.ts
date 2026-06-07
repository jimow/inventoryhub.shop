import { describe, it, expect } from "vitest";
import { ownershipPercents, netCapitalByShareholder } from "@/lib/equity";
import type { Shareholder, EquityContribution } from "@/lib/types";

const sh = (id: string, pct = 0) => ({ id, ownership_pct: pct } as unknown as Shareholder);
const con = (
  shareholder_id: string,
  amount: number,
  kind: "contribution" | "withdrawal" = "contribution",
  status = "posted",
) => ({ shareholder_id, amount, kind, status } as unknown as EquityContribution);

describe("ownership math", () => {
  it("nets contributions minus withdrawals, posted only", () => {
    const m = netCapitalByShareholder([
      con("a", 100),
      con("a", 40, "withdrawal"),
      con("b", 60),
      con("b", 999, "contribution", "draft"), // ignored (not posted)
    ]);
    expect(m.get("a")).toBe(60);
    expect(m.get("b")).toBe(60);
  });

  it("contribution mode splits ownership by net capital", () => {
    const p = ownershipPercents([sh("a"), sh("b")], [con("a", 75), con("b", 25)], "contribution");
    expect(p.get("a")).toBeCloseTo(75);
    expect(p.get("b")).toBeCloseTo(25);
  });

  it("fixed mode uses the manual ownership_pct", () => {
    const p = ownershipPercents([sh("a", 70), sh("b", 30)], [], "fixed");
    expect(p.get("a")).toBe(70);
    expect(p.get("b")).toBe(30);
  });

  it("zero total capital yields zero percents (no divide-by-zero)", () => {
    const p = ownershipPercents([sh("a")], [], "contribution");
    expect(p.get("a")).toBe(0);
  });
});
