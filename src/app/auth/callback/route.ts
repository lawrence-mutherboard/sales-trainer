import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/api/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;

  if (!code) return NextResponse.redirect(`${origin}/login?error=auth`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);

  // Enforce the company domain here (Google's "hd" hint alone is not a security control).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(`${origin}/setup`);
}
