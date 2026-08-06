/**
 * Stub for the `server-only` package under vitest.
 *
 * In the app that import is a build-time guard: it makes importing a
 * service-role module from a client component a hard error (CLAUDE.md §7).
 * Vitest has no client/server boundary to enforce, and the real package throws
 * on import outside a bundler, so it is aliased here to nothing.
 *
 * This does not weaken the guard — `next build` still resolves the real package
 * and still fails on a bad import.
 */
export {}
