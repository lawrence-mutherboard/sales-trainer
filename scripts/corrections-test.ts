// Run with: npm run test:corrections
import { applyCorrections } from "../src/lib/voice/corrections";
import corrections from "../config/speech_corrections.json";

function check(input: string, expected: string) {
  const got = applyCorrections(input, corrections.corrections);
  if (got === expected) console.log("ok  :", JSON.stringify(input), "->", JSON.stringify(got));
  else {
    console.error("FAIL:", JSON.stringify(input), "->", JSON.stringify(got), "expected", JSON.stringify(expected));
    process.exitCode = 1;
  }
}

check("Is now a bed time to talk?", "Is now a bad time to talk?");
check("Hi, it's Sam from Motherboard", "Hi, it's Sam from Mutherboard");
check("Motherboard helps teams with monday dot com", "Mutherboard helps teams with monday.com");
check("we set up your c r m in weeks", "we set up your CRM in weeks");
check("Are you using sales force or hub spot?", "Are you using Salesforce or HubSpot?");
check("Nothing to fix here, just a normal sentence.", "Nothing to fix here, just a normal sentence.");
check("bedtime stories", "bad time stories"); // known trade-off of the bedtime rule
check("the bed timer", "the bed timer"); // whole words only
check("monday.com is great", "monday.com is great"); // already right, untouched
