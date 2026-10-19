// Run with: npm run test:echo
import { echoesProspect } from "../src/lib/voice/echo";

const prospect = ["Sorry, you've lost me. I'm in the middle of something here, so if you've got a reason for calling, I'd need to hear it quickly.", "Hello?"];
const cases: [string, boolean][] = [
  ["Sorry, you've lost me. I'm in the middle of something here, so if you've got a reason for calling, I'd need to hear it quickly.", true],
  ["sorry you've lost me I'm in the middle of something here so if you've got a reason for calling I'd need to hear it quickly", true],
  ["Sorry about that. I'm calling because teams like yours lose hours each week chasing status updates.", false],
  ["You're in the middle of something?", false],
  ["Hello?", false],
  ["Understood, I'll be quick. We help operations teams get their projects out of spreadsheets, is that relevant?", false],
];
let failed = 0;
for (const [heard, expected] of cases) {
  const got = echoesProspect(heard, prospect);
  console.log(`${got === expected ? "ok  " : "FAIL"}  echo=${got}  "${heard.slice(0, 70)}"`);
  if (got !== expected) failed++;
}
if (failed) process.exitCode = 1;
