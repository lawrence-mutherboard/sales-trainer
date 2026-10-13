import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/api/auth";
import { isAllowedUser, refusalReason } from "@/lib/authDomain";
import { siteOrigin } from "@/lib/siteUrl";

// Landing point for the links in Supabase emails (confirm your email, reset your password).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = siteOrigin(request);

  // Only allow same-site relative redirects.
  const nextParam = url.searchParams.get("next") ?? "/setup";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.startsWith("/\\") ? nextParam : "/setup";

  if (!code) return NextResponse.redirect(`${origin}/login?error=auth`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);

  // Company domain AND a confirmed address, or they are signed straight back out.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedUser(user)) {
    const reason = user ? refusalReason(user) : "domain";
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=${reason}`);
  }

  await ensureProfile(user);
  return NextResponse.redirect(`${origin}${next}`);
}
