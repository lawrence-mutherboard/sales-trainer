import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { siteOrigin } from "@/lib/siteUrl";
import { isAllowedUser, refusalReason } from "@/lib/authDomain";

const PUBLIC_PATHS = ["/login", "/auth"];

// Refreshes the Supabase session cookie on every request and sends signed-out users to /login.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    // API routes get a 401 instead of a redirect.
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    // Build the address from the public site address, not the internal one the host may show us.
    return NextResponse.redirect(`${siteOrigin(request)}/login`);
  }

  // Signed in, but not a confirmed company address (for example someone who registered straight with the sign-up
  // service). They can't use any page or API; the login page then signs them out.
  if (user && !isAllowedUser(user) && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Account not allowed" }, { status: 403 });
    return NextResponse.redirect(`${siteOrigin(request)}/login?error=${refusalReason(user)}`);
  }
  return response;
}
