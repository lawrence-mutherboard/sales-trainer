# mutherboard Sales Roleplay Trainer: setup

The prototype lets a rep pick a scenario, hold a voice call with an AI prospect (cold call or discovery), and get a scored report. This guide takes you from nothing to a running app on your own machine.

**Cost:** Supabase and local development are free. The only cost is Claude API usage, which is pay-as-you-go (estimated below).

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

## 1. AI keys: Claude and ElevenLabs

The app uses two services, and nothing else:

| Service | What it does here |
|---|---|
| **Claude** (Anthropic) | Writes the prospect's replies and scores the call |
| **ElevenLabs** | Speaks the prospect's voice, and transcribes what you say accurately |

### Claude (Anthropic) key
1. Go to https://console.anthropic.com and sign in (or create an account).
2. **Settings → Billing**: add a payment method and a small credit balance. Set a monthly spend limit while you're testing.
3. **Settings → API keys → Create key**. Name it `sales-trainer-dev`. Copy it now, because it's only shown once.
4. If requests fail with "not scoped to a workspace", either create the key inside a workspace, or put the workspace ID in `ANTHROPIC_WORKSPACE_ID`.

You'll paste it into `.env.local` as `ANTHROPIC_API_KEY`.

### ElevenLabs key
1. Sign in at https://elevenlabs.io. The plan must allow API use, and commercial use if the team will use the app for work.
2. In the left menu go to **Developers → API Keys**, and create (or edit) a key. Give it these permissions, or turn the key's restriction off: **Text to Speech**, **Voices (Read)** and **Speech to Text**.
3. Paste it into `.env.local` as `ELEVENLABS_API_KEY`.
4. Check it works: `npm run elevenlabs:voices` lists your voices, and `npm run test:elevenlabs` and `npm run test:scribe` test the voice and the transcription.

---

## 2. Supabase project (free plan)

1. Go to https://supabase.com and sign in. **New project**.
2. Name: `sales-trainer`. Choose a strong database password and save it in your password manager. You won't need it in the app.
3. **Region: London (eu-west-2)**, for UK data residency.
4. When the project is ready, open **SQL Editor → New query**.
5. Open `supabase/migrations/0001_init.sql` from this project, paste the whole file in, and press **Run**.
   - It creates the trainer tables (all named `trainer_...`, so it can share a project with other tables) and the row-level security rules. It only creates; it never changes anything already in the project.
   - The 90-day clean-up is a commented-out block at the end of the file. Enable **Database, then Extensions, then pg_cron**, remove the leading `--` from that block, and run it on its own.
6. Get your keys from **Project Settings → API**:
   - **Project URL** for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** for `SUPABASE_SERVICE_ROLE_KEY`. **Keep this secret.** It bypasses all security rules and only ever lives on the server.

---

## 3. Sign-in: work email + password (restricted to mutherboard.com)

People create an account with their `@mutherboard.com` email and a password. Supabase stores only a scrambled (hashed) version of the password; the app never sees it. Accounts belong to the Supabase project, not to anyone's personal Google account, so access doesn't depend on any one person.

In Supabase:
1. **Authentication, then Sign In / Providers, then Email**: make sure it is **enabled** and **Confirm email** is **ON**. **Keep it on.** It proves that a person really owns the mailbox. Without it, anyone could register as `someone@mutherboard.com`. If this project is shared with other things, this setting applies to all of them, so check with whoever manages it before changing anything.
2. On the same page set the password rules to match the app: **Minimum password length 8**, and **require lowercase letters, uppercase letters and digits** (the app also checks this, but only Supabase can enforce it for everyone).
3. **Authentication, then URL Configuration**:
   - **Site URL**: your Render address (or `http://localhost:3000` while testing locally)
   - **Redirect URLs**: add `https://your-app.onrender.com/**` and `http://localhost:3000/**`

How it works: a person clicks **Create an account**, enters their name, work email and password, and receives a confirmation email. After clicking the link they sign in with email and password. **Forgot password?** sends a reset link.

**How the company-email rule is enforced.** Because the Supabase project may be shared, there is no database trigger. The app itself refuses anyone whose email is not on the company domain *or* is not confirmed: on every page, every API call, and when an email link is opened. The sign-up form also checks the domain. Someone outside the company who registers directly with Supabase can create an account there but cannot use this app.

**Email sending.** Supabase's built-in sender is meant for testing and allows only a handful of emails per hour. Before the whole team signs up, set up proper email sending under **Project Settings, then Authentication, then SMTP Settings** (or check whether the company project already has it). The confirmation and reset emails use the project's email templates, which may be shared with other apps.

To add a person by hand for testing: **Authentication, then Users, then Add user**, ticking **Auto Confirm User**.

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
| `ANTHROPIC_API_KEY` | From step 1 | Yes |
| `ANTHROPIC_WORKSPACE_ID` | Only if Anthropic says the key isn't tied to a workspace | No |
| `ELEVENLABS_API_KEY` | From step 1 | Yes |
| `NEXT_PUBLIC_TTS_PROVIDER` | `elevenlabs` for the prospect's ElevenLabs voice, or blank for the free (robotic) browser voice | No |
| `NEXT_PUBLIC_STT_PROVIDER` | `elevenlabs` for accurate speech recognition (ElevenLabs Scribe), or blank for Chrome only | No |
| `NEXT_PUBLIC_SUPABASE_URL` | From step 2.6 | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From step 2.6 | No (public by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 2.6 | **Yes, server only** |
| `ALLOWED_EMAIL_DOMAIN` | `mutherboard.com` | No |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | `mutherboard.com` (same as the line above; used by the sign-up form) | No |
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
update public.trainer_profiles set role = 'manager' where email = 'someone@mutherboard.com';

-- put a rep on that manager's team
update public.trainer_profiles
   set manager_id = (select id from public.trainer_profiles where email = 'someone@mutherboard.com')
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
| **Natural voice** | The prospect's speech comes from an ElevenLabs voice instead of the browser's, streamed so it starts quickly. The voice (gender and accent) is chosen from the prospect's name and stays the same all call. Turn on with `NEXT_PUBLIC_TTS_PROVIDER=elevenlabs` in `.env.local`. Choose favourite voices by pasting their IDs into `tts.elevenlabs.voices` (run `npm run elevenlabs:voices` to see yours); if the lists are empty the app picks matching voices from your account. | `config/ai.json → tts.elevenlabs` |
| **How it is spoken** | Each reply is spoken as the first sentence as soon as it is ready and the rest as one piece (`tts.speak_mode: "first_then_rest"`; `"whole"` is smoothest but slowest to start, `"sentences"` is quickest). `tts.speed` sets the pace (ElevenLabs allows 0.7 to 1.2). Numbers and names are tidied for speech ("£160" becomes "160 pounds"). | `config/ai.json → tts` |
| **Accurate speech recognition** | Your microphone is recorded (in memory only) and each turn is re-transcribed by ElevenLabs Scribe (`stt.model_id`) with a vocabulary hint, so it understands context ("bad time", not "bed time"; "mutherboard", not "motherboard"). Chrome still shows the live captions and spots when you stop talking; the transcription starts while you pause, so it adds little delay. If it's slow (over 3.5 s) or looks wrong, Chrome's text is used. Turn on with `NEXT_PUBLIC_STT_PROVIDER=elevenlabs`; delete the line for Chrome only. Add your own terms to `stt.vocabulary` (ElevenLabs charges a small extra for these hints; set `stt.use_keyterms` to false to stop). **Privacy: your voice now goes to Google (Chrome) and ElevenLabs. Update your privacy notice and data agreements accordingly.** | `config/ai.json → stt`, `config/speech_corrections.json` |
| **Personality and mood in the voice** | Every reply starts with a hidden mood tag (`{impatient}`, `{warm}`, ...). The voice follows it by becoming steadier or more animated, on top of a baseline for each personality (uninterested = flatter). It never changes which voice it is. | `tts.elevenlabs.moods`, `tts.elevenlabs.personalities` |
| **Staying in role** | A firm "you are the customer" section, a role reminder on every turn, and short example replies. Add an example whenever you catch the prospect getting something wrong. | `config/roleplay_examples.json` |
| **Accent mix** | Each prospect speaks with a fixed accent for the whole call, chosen at random: about 80% British, 20% American (`tts.accent.uk_percent`). British prospects use British ElevenLabs voices and American ones use American voices. | `config/ai.json → tts.accent` |
| **Report: speaking metrics** | The report shows talk time, speaking pace (words/min), filler words, longest stretch talking and questions asked, each against a benchmark from public sales research (Gong, Hyperbound), with the sources listed in the report. Computed in code from your recording and timestamps, not judged by the AI. Pace and monologue are estimates; filler counts are a minimum because speech-to-text often removes fillers (the transcription is told to keep them). | `config/benchmarks.json` |
| **Silence follow-ups** | If you go quiet in a voice call, the prospect says "Hello?" after 4 s, another "Hello?" 2 s after that, then a goodbye and hangs up 2 s later. Any speech from you resets it. Not used in typed calls. The lines are saved in the transcript. | `config/silence.json` |
| **Fillers** (off by default) | A quick "Mm." or "Right." while a slow reply loads. They fired on almost every turn once replies were spoken as one piece, so they are switched off. Add phrases to `tts.fillers` to try them again. | `config/ai.json → tts.fillers` |
| **Portraits** | A photo of the prospect on the call screens, with a glow while they speak. Shows initials until you add photos: drop images into `public/portraits/` and list each in `manifest.json` as `{ "file": "name.jpg", "gender": "feminine" }` (or `"masculine"`). Use AI-generated or stock faces you have the right to use. | `public/portraits/` |

**Test that the prospect stays in role** (a few cents; uses your AI key):

```bash
npm run test:role
```

Re-run it after changing the model, the prompt or the examples. It sends 20 tricky rep lines and flags replies that sound like a salesperson.

Portraits are matched to the prospect's name (feminine or masculine), never to personality or difficulty, and are labelled "AI-generated fictional person". Change that label in `src/components/Avatar.tsx` if your photos are not AI-generated.

**Tuning the feel:**
- If the prospect cuts you off when you pause to think, raise `SILENCE_AFTER_FINAL_MS` in `src/lib/voice/browser.ts`.
- If it ever slips out of role, add an example of the right reply to `config/roleplay_examples.json` and re-run `npm run test:role`.

---

## 8. Costs (estimates)

**Tokens per 10-minute discovery call** (from the real prompt sizes, with an assumed 20 exchanges):
- Prospect: about 68,000 input tokens (the ~2,000-token instructions are re-sent each turn) and about 1,200 output tokens.
- Scoring: about 5,500 input tokens and about 2,500 to 8,000 output tokens.
- A 5-minute cold call is roughly half of the prospect figure.

**With Claude** (Sonnet 5.5 at $2 / $10 per million tokens in / out for the prospect, Opus 5.5 at $4 / $20 for scoring): about **15 to 35 US cents per call**, so about $15 to $35 per 100 calls.

**ElevenLabs** is billed by characters (voice) and by seconds of audio (transcription), against your plan's allowance. A 10-minute call has roughly 3,000 to 4,000 characters of prospect speech. Check your plan's allowance and prices on ElevenLabs' site; I haven't verified current prices.

These are estimates, not measurements. After your first few calls, check real spend in the provider's usage page. In development the server terminal logs cached-token counts for each prospect turn (`cache_read=`). If they stay at `0` after the second turn, prompt caching isn't kicking in and calls cost a bit more.

---

## 8b. Putting it online on Render

1. Push the project to a **private** GitHub repository (never commit `.env.local`).
2. On render.com: **New +, then Web Service** (or **Blueprint** to use the included `render.yaml`), and pick the repository. Use:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment variable `NODE_VERSION` = `22`
3. Under **Environment**, add every value from your `.env.local` (names are listed in `render.yaml` and `.env.example`). Set:
   - `SITE_URL` = your Render address, for example `https://your-app.onrender.com`
   - `NEXT_PUBLIC_SITE_URL` = the same address
   - Variables starting with `NEXT_PUBLIC_` are baked into the build. After changing one, use **Manual Deploy, then Clear build cache and deploy**.
4. **Supabase, Authentication, URL Configuration** (this is the usual cause of being sent back to localhost after clicking a link in an email):
   - **Site URL** = your Render address (not `http://localhost:3000`)
   - **Redirect URLs**: add `https://your-app.onrender.com/auth/callback`. Keep the localhost one too for local testing.
5. Make sure **Confirm email** is ON in Supabase (section 3) before sharing the link.
6. Free Render instances **sleep after about 15 minutes idle**; the first visit afterwards takes about a minute. Set spending limits with Anthropic and ElevenLabs before sharing the link.

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
| "Only mutherboard.com email addresses can use this app" | You used a non-company email |
| "Please confirm your email first" | Click the link in the confirmation email (check spam), or add the user by hand in Supabase with Auto Confirm |
| No confirmation email arrives | Supabase's built-in sender is rate-limited. Wait, set up your own SMTP (section 3), or create the user by hand |
| The email link says "That link didn't work" | Open it in the same browser you signed up in. If you already clicked it, just sign in with your password |
| "Couldn't create the session" | Migration not run, or wrong `SUPABASE_SERVICE_ROLE_KEY` |
| Prospect never answers | Check the terminal running `npm run dev` for an Anthropic error (billing, wrong key, unknown model) |
| Nothing happens when you talk | Mic blocked (padlock in the address bar), or not using Chrome/Edge |
| Prospect's voice isn't British | Your OS has no en-GB voice installed. Chrome falls back to another English voice |
