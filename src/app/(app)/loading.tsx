import { PageLoader } from "@/components/loader";

/**
 * Default loading skeleton for any (app) route that doesn't ship its own
 * loading.tsx. Combined with NavProgress' top bar this makes every click
 * feel instant.
 */
export default function Loading() {
  return <PageLoader rows={10} />;
}
