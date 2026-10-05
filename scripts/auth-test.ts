// Run with: npm run test:auth
// Checks who is allowed in: only a CONFIRMED address on exactly the company domain.
import { isAllowedEmail, isAllowedUser, refusalReason } from "../src/lib/authDomain";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

delete process.env.ALLOWED_EMAIL_DOMAIN;
delete process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

assert(isAllowedEmail("lawrence@mutherboard.com"), "a company address is allowed");
assert(isAllowedEmail("Lawrence@Mutherboard.COM"), "capital letters do not matter");
assert(!isAllowedEmail("someone@gmail.com"), "another domain is refused");
assert(!isAllowedEmail("someone@evil-mutherboard.com"), "a look-alike domain is refused");
assert(!isAllowedEmail("someone@mail.mutherboard.com"), "a sub-domain is refused");
assert(!isAllowedEmail("someone@mutherboard.com.evil.com"), "the company domain as a prefix is refused");
assert(!isAllowedEmail("a@evil.com@mutherboard.com"), "two @ signs are refused");
assert(!isAllowedEmail(""), "empty is refused");
assert(!isAllowedEmail(null), "missing is refused");

const confirmed = { email: "a@mutherboard.com", email_confirmed_at: "2026-10-01T10:00:00Z" };
assert(isAllowedUser(confirmed), "a confirmed company address is allowed");
assert(!isAllowedUser({ email: "a@mutherboard.com", email_confirmed_at: null }), "an unconfirmed address is refused");
assert(refusalReason({ email: "a@mutherboard.com", email_confirmed_at: null }) === "unconfirmed", "...with the reason 'unconfirmed'");
assert(!isAllowedUser({ email: "a@gmail.com", email_confirmed_at: "2026-10-01T10:00:00Z" }), "a confirmed outside address is refused");
assert(refusalReason({ email: "a@gmail.com" }) === "domain", "...with the reason 'domain'");

process.env.ALLOWED_EMAIL_DOMAIN = "@Example.org";
assert(isAllowedEmail("x@example.org"), "the domain can be changed with ALLOWED_EMAIL_DOMAIN");
