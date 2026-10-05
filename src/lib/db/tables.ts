// The names of this app's database tables. Every one starts with "trainer_" so the app can share a Supabase project
// with other tables (for example the company's own) without touching or clashing with them.
// If you rename a table in the database, change it here and nowhere else.
export const TABLES = {
  profiles: "trainer_profiles",
  sessions: "trainer_sessions",
  turns: "trainer_turns",
  scores: "trainer_scores",
  secrets: "trainer_session_secrets",
} as const;
