import { describe, it, expect } from "vitest";
import { computeLineTotals } from "@/lib/utils";

describe("computeLineTotals — taxable flag", () => {
  it("taxes all lines when none are marked non-taxable", () => {
    const r = computeLineTotals([{ qty: 2, price: 100 }], 0, 16);
    expect(r.subtotal).toBe(200);
    expect(r.tax).toBe(32);
    expect(r.total).toBe(232);
  });

  it("charges 0 tax on a non-taxable line", () => {
    const r = computeLineTotals([{ qty: 1, price: 100, taxable: false }], 0, 16);
    expect(r.subtotal).toBe(100);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(100);
  });

  it("taxes only the taxable portion of a mixed cart", () => {
    const r = computeLineTotals(
      [{ qty: 1, price: 100, taxable: true }, { qty: 1, price: 100, taxable: false }],
      0,
      16,
    );
    expect(r.subtotal).toBe(200);
    expect(r.tax).toBe(16); // only the taxable 100 is taxed
    expect(r.total).toBe(216);
  });

  it("allocates discount proportionally to the taxable base", () => {
    const r = computeLineTotals(
      [{ qty: 1, price: 100, taxable: true }, { qty: 1, price: 100, taxable: false }],
      40, // 20% discount across both lines → taxable base 80
      10,
    );
    expect(r.tax).toBeCloseTo(8); // 10% of 80
  });
});
