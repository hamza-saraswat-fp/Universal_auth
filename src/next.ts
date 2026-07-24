/**
 * `@fieldpulse/auth/next` — Next.js integration.
 *
 * Session refresh plus server-side guards for App Router apps.
 *
 * TODO(IAI-408): fpAuthProxy(), getServerClaims(), requireAppServer().
 *
 * Two things this must get right when implemented:
 *   - Refresh with `supabase.auth.getClaims()`, never `getSession()`. Only the
 *     former verifies the JWT signature; `getSession()` returns unverified
 *     cookie contents and cannot be trusted in server code.
 *   - Set Cache-Control / Expires / Pragma on any response that touches auth
 *     cookies, so a session can't be cached and served to someone else.
 *
 * Exported so it works as either `middleware` (Next 14/15) or `proxy` (Next 16+).
 * An app must not define both files — the behavior is unpredictable.
 */

export {};
