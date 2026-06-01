import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Force every Supabase request to bypass the Next.js Data Cache.
 *
 * Without this, server-component reads via supabase-js get cached at the Next
 * fetch layer and return stale snapshots — `dynamic = "force-dynamic"` is not
 * always enough on its own (esp. in dev). This makes correctness independent
 * of route-level cache config.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/**
 * Server-side Supabase client scoped to the request's cookies.
 * Use in Server Components, Route Handlers, and Server Actions.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component. This can be
            // ignored if middleware refreshes user sessions.
          }
        },
      },
      global: { fetch: noStoreFetch },
    },
  );
}

/**
 * Service-role Supabase client. Bypasses RLS — server-only, never expose
 * the service role key to the browser.
 */
export function createServiceRoleClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
      global: { fetch: noStoreFetch },
    },
  );
}
