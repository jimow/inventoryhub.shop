// 'pg' is an optional, server-only dependency used by the tenant provisioning
// path (src/lib/provisioning.ts) and the CLI scripts. It ships no bundled
// types and we don't depend on @types/pg, so declare a permissive module so the
// dynamic import typechecks. The real package is resolved at runtime.
declare module "pg";
