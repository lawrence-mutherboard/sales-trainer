# mutherboard Sales Roleplay Trainer: setup

The prototype lets a rep pick a scenario, hold a voice call with an AI prospect (cold call or discovery), and get a scored report. This guide takes you from nothing to a running app on your own machine.

**Cost:** Supabase, Google Cloud sign-in and local development are free. The only cost is Claude API usage, which is pay-as-you-go (estimated below).

---

## 0. What you need to install

| Thing | Why | Where |
|---|---|---|
| **Node.js 20 or later (LTS)** | Runs the app | https://nodejs.org |
| **Google Chrome or Edge** | Voice calls use the browser's speech features, which only work in Chromium browsers | |

Check Node in a new terminal window:

```bash
node -v
```

---

## 1. AI key: Claude (intended) or OpenAI (to try the app now)

**No Anthropic API access yet?** The app can run on OpenAI in the meantime:
1. Create a key at https://platform.openai.com/api-keys (add a small credit balance in Billing).
2. In `.env.local` set `LLM_PROVIDER=openai` and `OPENAI_API_KEY=...` (step 4).
3. Models are set in `config/ai.json` under `openai` (default `gpt-4.1-mini` for the prospect and `gpt-4.1` for scoring).

Treat OpenAI as a stand-in for testing: the prompts and rubric were written for Claude, so prospect realism and scoring consistency may be lower. Don't use it for calibration or real team scores. When Anthropic access arrives, set `LLM_PROVIDER=anthropic` (or delete the line) and add `ANTHROPIC_API_KEY`. Nothing else changes.

### Anthropic key (the intended provider)

1. Go to https://console.anthropic.com and sign in (or create an account).
2. **Settings → Billing**: add a payment method and a small credit balance. Set a monthly spend limit while you're testing.
3. **Settings → API keys → Create key**. Name it `sales-trainer-dev`. Copy it now, because it's only shown once.

You'll paste it into `.env.local` as `ANTHROPIC_API_KEY`.

---

## 2. Supabase project (free plan)

1. Go to https://supabase.com and sign in. **New project**.
2. Name: `sales-trainer`. Choose a strong database password and save it in your password manager. You won't need it in the app.
3. **Region: London (eu-west-2)**, for UK data residency.
4. When the project is ready, open **SQL Editor → New query**.
5. Open `supabase/migrations/0001_init.sql` from this project, paste the whole file in, and press **Run**.
   - It creates the tables, row-level security and the 90-day cleanup job.
   - If you see a notice about `pg_cron`, go to **Database → Extensions**, enable **pg_cron**, then run the last `do $$ ... $$;` block of the file again.
6. Get your keys from **Project Settings → API**:
   - **Project URL** for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** for `SUPABASE_SERVICE_ROLE_KEY`. **Keep this secret.** It bypasses all security rules and only ever lives on the server.

---

## 3. Google sign-in (restricted to mutherboard.com)

### 3a. Google Cloud OAuth client
1. Go to https://console.cloud.google.com and create a project (for example `sales-trainer`). Use your mutherboard.com Google account.
2. **APIs & Services → OAuth consent screen**.
   - User type: **Internal** if your mutherboard.com Google account is a Google Workspace organisation. This blocks anyone outside the company at Google's end. Otherwise choose External.
   - Fill in the app name (`Sales Trainer`) and your support email, then save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorised redirect URIs**: add `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. You can copy the exact URL from Supabase in step 3b.
4. Copy the **Client ID** and **Client secret**.

### 3b. Turn it on in Supabase
1. **Authentication → Providers → Google**: enable it and paste the Client ID and Client secret. The callback URL shown here is the one to put in Google (step 3a.3).
2. **Authentication → URL Configuration**:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: add `http://localhost:3000/auth/callback`
   - When you deploy, add your live address and `/auth/callback` too.

The domain restriction is enforced three times: Google's consent screen (if Internal), the app's sign-in callback, and a database rule that refuses to create any non-`@mutherboard.com` account.

---

## 4. Environment variables

In the project folder, copy the template:

```bash
cp .env.example .env.local
```

(On Windows PowerShell: `Copy-Item .env.example .env.local`.)

Fill in `.env.local`:

| Variable | Value | Secret? |
|---|---|---|
| `LLM_PROVIDER` | `openai` for now, `anthropic` once you have Claude access | No |
| `OPENAI_API_KEY` | From step 1 (only if using OpenAI) | Yes |
| `ANTHROPIC_API_KEY` | From step 1 (only if using Claude) | Yes |
| `NEXT_PUBLIC_TTS_PROVIDER` | `openai` for the natural prospect voice, or blank for the free browser voice | No |
| `NEXT_PUBLIC_STT_PROVIDER` | `openai` for accurate speech recognition, or blank for Chrome only | No |
| `NEXT_PUBLIC_SUPABASE_URL` | From step 2.6 | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From step 2.6 | No (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 2.6 | **Yes, server only** |
| `ALLOWED_EMAIL_DOMAIN` | `mutherboard.com` | No |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | No |

`.env.local` is in `.gitignore`. Never commit it.

---

## 5. Run it

```bash
npm install
npm run check-config
npm run typecheck
npm run dev
```

- `check-config` validates everything in `/config` (rubric totals, scenario links, and so on).
- `typecheck` should print nothing. **It has never been run**, because the code was written on a machine without Node, so expect to fix a few small type errors on the first run.

Open http://localhost:3000 in **Chrome**, sign in with your mutherboard.com account, and start a call. Use **headphones**: the mic is muted while the prospect speaks, but speakers can still cause echo.

---

## 6. Managers

New accounts are reps. In Supabase **SQL Editor**:

```sql
-- make someone a manager
update public.profiles set role = 'manager' where email = 'someone@mutherboard.com';

-- put a rep on that manager's team
update public.profiles
   set manager_id = (select id from public.profiles where email = 'someone@mutherboard.com')
 where email = 'rep@mutherboard.com';
```

Database rules already let managers read their team's calls. The team dashboard is Phase 3.

---

## 7. Editing business content (no code changes)

Everything a manager might want to change is in `/config`:

| File | What's in it |
|---|---|
| `business.json` | Hourly rate, monday.com pricing (`last_verified`), services offered, discount rule |
| `personas.json` | Departments, titles, pains, budgets, personalities, difficulty behaviour, name pools |
| `objections.json` | The objection library and which personas get which |
| `scenarios.json` | Success conditions, time limits, scenario briefs. `enabled` turns a scenario on |
| `rubric.json` | Every scoring criterion and its points (core 30 + module 60 + accuracy 10) |
| `ai.json` | Which AI provider and models are used, the scorer's effort, the prospect's voice (speed, voices, vibe), refusal fallback on/off |
| `speech_corrections.json` | Words the speech recognition regularly mishears ("bed time" → "bad time", "motherboard" → "mutherboard"). Add a line whenever you spot a repeat mistake |
| `roleplay_examples.json` | Short example replies that keep the prospect in role |
| `silence.json` | What the prospect does when the rep goes quiet (timings and lines) |
| `listening.json` | How long the app waits after you stop talking before deciding your turn is over. It waits longer if you stopped mid-sentence ("...and", "...the") and less if you clearly finished |
| `benchmarks.json` | Targets shown beside your speaking metrics in the report, with the research sources |

Restart `npm run dev` (or it hot-reloads) after editing, and run `npm run check-config` to catch mistakes.

**Before real use, please fill in or confirm:**
- `business.json → monday_pricing.last_verified` (the prices came from the spec and haven't been checked against monday.com).
- `business.json → company.services_not_offered` (for example whether mutherboard resells monday.com licences), which the accuracy check uses.
- `business.json → discount_rule` (placeholder).

---

## 7b. Making the prospect feel human

| Feature | How it works | Where to change it |
|---|---|---|
| **Natural voice** | The prospect's speech comes from OpenAI's neural voice instead of the browser's. Same voice all call. Turn on with `NEXT_PUBLIC_TTS_PROVIDER=openai` in `.env.local`; delete the line for the free browser voice. Needs `OPENAI_API_KEY` even if the AI brain is Claude. | `config/ai.json → tts` |
| **openai.fm-style delivery** | The voice model is the same one behind openai.fm. The app uses its "vibe" format (`tts.instructions`: affect, tone, pacing, emotion...), speaks the first sentence as soon as it is ready and the rest as one piece (`tts.speak_mode: "first_then_rest"`; `"whole"` is smoothest but slowest to start, `"sentences"` is the quickest), and streams the audio so it starts before the clip is finished. To match a voice or vibe you liked on openai.fm, put the voice name in `tts.voices` and the vibe text in `tts.instructions`. `tts.speed` sets the pace (1.0 is normal; 1.2 is brisk). | `config/ai.json → tts` |
| **Accurate speech recognition** | Your microphone is recorded (in memory only) and each turn is re-transcribed by OpenAI (`gpt-4o-transcribe`) with a vocabulary hint, so it understands context ("bad time", not "bed time"; "mutherboard", not "motherboard"). Chrome still shows the live captions and spots when you stop talking; the OpenAI transcription starts while you pause, so it adds little delay. If it's slow (over 3.5 s) or looks wrong, Chrome's text is used. Turn on with `NEXT_PUBLIC_STT_PROVIDER=openai` in `.env.local`; delete the line for Chrome only. Add your own terms to `stt.vocabulary`. Cost is a few cents per call (check OpenAI's pricing). **Privacy: your voice now goes to Google (Chrome) and OpenAI. Update your privacy notice and data agreements accordingly.** | `config/ai.json → stt`, `config/speech_corrections.json` |
| **Personality and mood in the voice** | Every reply starts with a hidden mood tag (`{impatient}`, `{warm}`, ...). The voice follows it, on top of a per-personality style (uninterested = flat and tired). | `tts.personality_style`, `tts.moods` |
| **Staying in role** | A firm "you are the customer" section, a role reminder on every turn, and short example replies. Add an example whenever you catch the prospect getting something wrong. | `config/roleplay_examples.json` |
| **Accent mix** | Each prospect speaks with a fixed accent for the whole call, chosen at random: about 80% British, 20% American (`tts.accent.uk_percent`). The OpenAI voices are US-native, so the British accent is an imitation steered by the instructions | `config/ai.json → tts.accent` |
| **Report: speaking metrics** | The report shows talk time, speaking pace (words/min), filler words, longest stretch talking and questions asked, each against a benchmark from public sales research (Gong, Hyperbound), with the sources listed in the report. Computed in code from your recording and timestamps, not judged by the AI. Pace and monologue are estimates; filler counts are a minimum because speech-to-text often removes fillers (the transcription is told to keep them). | `config/benchmarks.json` |
| **Silence follow-ups** | If you go quiet in a voice call, the prospect says "Hello?" after 4 s, another "Hello?" 2 s after that, then a goodbye and hangs up 2 s later. Any speech from you resets it. Not used in typed calls. The lines are saved in the transcript. | `config/silence.json` |
| **Fillers** (off by default) | A quick "Mm." or "Right." while a slow reply loads. They fired on almost every turn once replies were spoken as one piece, so they are switched off. Add phrases to `tts.fillers` to try them again. | `config/ai.json → tts.fillers` |
| **Portraits** | An AI-generated face on the call screens, with a glow while they speak. Falls back to initials until you generate some (below). | `public/portraits/` |

**Test that the prospect stays in role** (a few cents; uses your AI key):

```bash
npm run test:role
```

Re-run it after changing the model, the prompt or the examples. It sends 20 tricky rep lines and flags replies that sound like a salesperson.

**Generate the portrait library** (costs money per image; check OpenAI's pricing first, `low` quality is cheapest):

```bash
npm run portraits                       # shows the plan, spends nothing
npm run portraits -- --yes              # generates 12 portraits
npm run portraits -- --yes --count 30   # generates 30
```

Portraits are matched to the prospect's name (feminine or masculine), never to personality or difficulty, and are labelled "AI-generated fictional person". You can also drop your own photos into `public/portraits/` and list them in `manifest.json` as `{ "file": "name.jpg", "gender": "feminine" }`.

**Tuning the feel:**
- If the prospect cuts you off when you pause to think, raise `SILENCE_AFTER_FINAL_MS` in `src/lib/voice/browser.ts`.
- If it still slips out of role, change `openai.prospect_model` in `config/ai.json` to `gpt-4.1` (a bit slower and dearer, better at holding a role).

---

## 8. Costs (estimates)

**Tokens per 10-minute discovery call** (from the real prompt sizes, with an assumed 20 exchanges):
- Prospect: about 68,000 input tokens (the ~2,000-token instructions are re-sent each turn) and about 1,200 output tokens.
- Scoring: about 5,500 input tokens and about 2,500 to 8,000 output tokens.
- A 5-minute cold call is roughly half of the prospect figure.

**With Claude** (Sonnet 5.5 at $2 / $10 per million tokens in / out for the prospect, Opus 5.5 at $4 / $20 for scoring): about **15 to 35 US cents per call**, so about $15 to $35 per 100 calls.

**With OpenAI** (`gpt-4.1-mini` prospect, `gpt-4.1` scorer): about **5 to 10 US cents per call**, if the prices are still what I remember from those models' launch ($0.40 / $1.60 and $2 / $8 per million tokens). **Check OpenAI's pricing page before relying on this.**

The natural voice adds a small extra cost (a cent or two per minute of prospect speech, from memory; check OpenAI's pricing). Portrait generation is a one-off, per image.

These are estimates, not measurements. After your first few calls, check real spend in the provider's usage page. In development the server terminal logs cached-token counts for each prospect turn (`cache_read=` for Claude, `cached=` for OpenAI). If they stay at `0` after the second turn, prompt caching isn't kicking in and calls cost a bit more.

---

## 9. Known limitations of the prototype

- **Chrome/Edge only** for voice. Other browsers get the typing fallback.
- Speech recognition is done by Google's service, so voice is sent to Google. The privacy notice should say so. Nothing is stored as audio.
- The rep can't interrupt the prospect (the mic is muted while they speak). Whether the rep interrupted is judged from the text only.
- Punctuation in transcripts is missing, and the odd word will be misheard. The scorer is told to allow for this.
- If a rep reloads the page mid-call, the call can't be resumed. They can end it and score what was said.
- Demo, objection handling and pricing negotiation are fully configured but switched off (`enabled: false`) until Phase 2, when calibration against human-scored transcripts is done.
- Hosting: Vercel's free Hobby plan is for non-commercial use only. For a company app, use a paid plan or another host. Local development needs none of this.
- The 90-day cleanup is a database job. Confirm it exists under **Database → Cron** in Supabase.

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in bounces back with "Only mutherboard.com accounts" | Signed in with a non-company Google account |
| `redirect_uri_mismatch` from Google | The Supabase callback URL isn't in Google's Authorised redirect URIs (step 3a.3) |
| "Couldn't create the session" | Migration not run, or wrong `SUPABASE_SERVICE_ROLE_KEY` |
| Prospect never answers | Check the terminal running `npm run dev` for an Anthropic error (billing, wrong key, unknown model) |
| Nothing happens when you talk | Mic blocked (padlock in the address bar), or not using Chrome/Edge |
| Prospect's voice isn't British | Your OS has no en-GB voice installed. Chrome falls back to another English voice |
