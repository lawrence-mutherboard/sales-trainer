import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { accessFor } from "@/lib/team/access";

export async function Header() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await accessFor(user);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={user ? "/" : "/login"} className="text-lg font-semibold tracking-tight text-indigo-600">
          mutherboard <span className="font-normal text-slate-500">Sales Trainer</span>
        </Link>
        {user && (
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/setup" className="text-slate-700 hover:text-indigo-600">
              New call
            </Link>
            <Link href="/history" className="text-slate-700 hover:text-indigo-600">
              My calls
            </Link>
            {access.isManager && (
              <Link href="/team" className="font-medium text-slate-700 hover:text-indigo-600">
                Team
              </Link>
            )}
            {access.isAdmin && (
              <Link href="/admin" className="font-medium text-slate-700 hover:text-indigo-600">
                Admin
              </Link>
            )}
            <span className="hidden text-slate-400 sm:inline">{user.email}</span>
            <SignOutButton />
          </nav>
        )}
      </div>
    </header>
  );
}
