// Who may use the app: a confirmed email address on the company domain. No database trigger enforces this (the
// Supabase project is shared with other things), so the app checks it itself, on every page and every API call.

export function allowedDomain(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "mutherboard.com")
    .toLowerCase()
    .replace(/^@/, "")
    .trim();
}

/** True only when the part after the last @ is exactly the company domain (so "a@b.com@mutherboard.com" fails). */
export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1).toLowerCase() === allowedDomain() && !email.slice(0, at).includes("@");
}

export interface UserLike {
  email?: string | null;
  email_confirmed_at?: string | null;
}

/** The company domain AND a confirmed address: proof that the person actually owns that mailbox. */
export function isAllowedUser(user: UserLike | null | undefined): boolean {
  return !!user && isAllowedEmail(user.email) && Boolean(user.email_confirmed_at);
}

export type RefusalReason = "domain" | "unconfirmed";

export function refusalReason(user: UserLike): RefusalReason {
  return isAllowedEmail(user.email) ? "unconfirmed" : "domain";
}
