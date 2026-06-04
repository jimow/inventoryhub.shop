// Pure, shared ownership math. Used by the Equity page (display) and the
// Dividends action (allocation) so a shareholder's % is computed identically
// everywhere — the single source of truth for ownership.
import type { Shareholder, EquityContribution } from "@/lib/types";

export type OwnershipMode = "contribution" | "fixed";

/** Net capital per shareholder = Σ(contributions − withdrawals), posted only. */
export function netCapitalByShareholder(contributions: EquityContribution[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of contributions) {
    if (c.status !== "posted") continue;
    const delta = c.kind === "contribution" ? Number(c.amount) : -Number(c.amount);
    m.set(c.shareholder_id, (m.get(c.shareholder_id) || 0) + delta);
  }
  return m;
}

/**
 * Effective ownership % per shareholder id.
 *  - "contribution": each owner's net capital ÷ total net capital × 100.
 *  - "fixed": the manually-entered ownership_pct on the shareholder.
 * Returns a map keyed by shareholder id; missing → 0.
 */
export function ownershipPercents(
  shareholders: Shareholder[],
  contributions: EquityContribution[],
  mode: OwnershipMode,
): Map<string, number> {
  const out = new Map<string, number>();
  if (mode === "fixed") {
    for (const s of shareholders) out.set(s.id, Number(s.ownership_pct || 0));
    return out;
  }
  const net = netCapitalByShareholder(contributions);
  // Only positive net capital counts toward shares.
  let total = 0;
  for (const s of shareholders) total += Math.max(0, net.get(s.id) || 0);
  for (const s of shareholders) {
    const cap = Math.max(0, net.get(s.id) || 0);
    out.set(s.id, total > 0 ? (cap / total) * 100 : 0);
  }
  return out;
}
