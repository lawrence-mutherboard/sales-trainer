import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Runs before every page request: refreshes the sign-in cookie and sends signed-out users to /login.
// API routes are skipped here on purpose. They check sign-in themselves, and skipping saves a
// network round trip on every call turn. (This file was called "middleware" before Next.js 16.)
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
