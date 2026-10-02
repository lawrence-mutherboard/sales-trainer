// Run with: npm run test:siteurl
// Checks which public address sign-in redirects use, including the case that went wrong on Render
// (the app only sees an internal localhost address while visitors use the real one).
import { siteOrigin } from "../src/lib/siteUrl";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

delete process.env.SITE_URL;
delete process.env.NEXT_PUBLIC_SITE_URL;

assert(
  siteOrigin(req("http://localhost:10000/auth/callback", { "x-forwarded-host": "my-app.onrender.com", "x-forwarded-proto": "https" })) ===
    "https://my-app.onrender.com",
  "behind a proxy, the visitor's address is used instead of the internal localhost one",
);

process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
assert(
  siteOrigin(req("http://localhost:10000/x", { "x-forwarded-host": "my-app.onrender.com", "x-forwarded-proto": "https" })) ===
    "https://my-app.onrender.com",
  "a leftover NEXT_PUBLIC_SITE_URL=localhost does not override the real address",
);
assert(siteOrigin(req("http://localhost:3000/x")) === "http://localhost:3000", "on your own computer it stays http://localhost:3000");

process.env.SITE_URL = "https://custom.example.com/";
assert(
  siteOrigin(req("http://localhost:10000/x", { "x-forwarded-host": "my-app.onrender.com", "x-forwarded-proto": "https" })) ===
    "https://custom.example.com",
  "SITE_URL wins when set (trailing slash removed)",
);
delete process.env.SITE_URL;

assert(
  siteOrigin(req("http://localhost:10000/x", { "x-forwarded-host": "evil.com/<script>", "x-forwarded-proto": "https" })) === "http://localhost:3000",
  "a malformed forwarded host is ignored",
);
