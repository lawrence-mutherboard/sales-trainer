// The password rule, in one place (used by the sign-up form and the reset-password page).
// Also set the same rule in Supabase (Authentication -> Sign In / Providers -> Email) so it is enforced on the server too.

export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, with an uppercase letter, a lowercase letter and a number.`;

/** Returns what is missing, or an empty list if the password is fine. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  if (!/[a-z]/.test(password)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("an uppercase letter");
  if (!/[0-9]/.test(password)) problems.push("a number");
  return problems;
}

/** A sentence for the person, or null if the password meets the rule. */
export function passwordMessage(password: string): string | null {
  const p = passwordProblems(password);
  if (p.length === 0) return null;
  return `Your password needs ${p.length === 1 ? p[0] : `${p.slice(0, -1).join(", ")} and ${p[p.length - 1]}`}.`;
}
