// Run with: npm run test:punctuate
import { punctuateTurn } from "../src/lib/voice/punctuate";

function check(pieces: string[], expected: string) {
  const got = punctuateTurn(pieces);
  if (got === expected) console.log("ok  :", JSON.stringify(pieces), "->", JSON.stringify(got));
  else {
    console.error("FAIL:", JSON.stringify(pieces), "->", JSON.stringify(got), "expected", JSON.stringify(expected));
    process.exitCode = 1;
  }
}

check(["is now a bad time to talk"], "Is now a bad time to talk?");
check(["hi it's sam from mutherboard"], "Hi it's sam from mutherboard.");
check(["what tools do you use at the moment"], "What tools do you use at the moment?");
check(["so how does that work today"], "So how does that work today?");
check(["i think i can help with that"], "I think I can help with that.");
check(["we help teams get monday.com working", "so it actually gets used"], "We help teams get monday.com working, so it actually gets used.");
check(["I know I'm calling out of the blue", "have you got a minute"], "I know I'm calling out of the blue, have you got a minute?");
check(["That makes sense."], "That makes sense.");
check(["Is that right?"], "Is that right?");
check(["i'll send an email and i'd love to chat"], "I'll send an email and I'd love to chat.");
check(["okay"], "Okay.");
check([], "");
check(["  ", ""], "");
check(["you guys use monday today"], "You guys use monday today?");
check(["so that's your CRM right"], "So that's your CRM right?");
check(["we are on salesforce at the moment"], "We are on salesforce at the moment.");
