import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function Header() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={user ? "/setup" : "/login"} className="text-lg font-semibold tracking-tight text-indigo-600">
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
            <span className="hidden text-slate-400 sm:inline">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100" type="submit">
                Sign out
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
