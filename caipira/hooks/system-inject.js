#!/usr/bin/env node
// caipira/hooks/system-inject.js — CodeWhale session_start hook
// Injects caipira compression rules into system prompt.
// Outputs additionalContext which CodeWhale prepends to system instructions.
//
// Reads .caipira-active for intensity level (default: full).

const fs = require('fs');
const path = require('path');
const os = require('os');

function getActiveMode() {
  const flagPath = path.join(os.homedir(), '.claude', '.caipira-active');
  try {
    const mode = fs.readFileSync(flagPath, 'utf8').trim();
    if (['lite', 'full', 'ultra'].includes(mode)) return mode;
  } catch {}
  return 'full';
}

const RULESETS = {
  lite: `CAIPIRA MODE — lite
No filler/hedging. Keep articles + full sentences. Tight. Professional.

Persistence: EVERY RESPONSE. Off: "stop caipira" / "normal mode".
- Drop: filler (just/really/basically), hedging, pleasantries
- Keep: articles, full sentences, professional tone
- No tool-call narration, no decorative tables/emoji
- Standard tech acronyms OK; never invent abbreviations
- Preserve user's dominant language`,

  full: `CAIPIRA MODE — full
Respond terse. Technical substance stays. Fluff dies.

Persistence: EVERY RESPONSE. Off: "stop caipira" / "normal mode".
- Drop: articles (a/an/the), filler, pleasantries, hedging
- Fragments OK. Short synonyms.
- No tool-call narration, no decorative tables/emoji
- Standard tech acronyms OK (DB/API/HTTP); never invent new ones
- Technical terms exact. Code blocks unchanged. Errors quoted exact
- Preserve user's dominant language
- No self-reference. Never name or announce the style

Pattern: [thing] [action] [reason]. [next].

Auto-Clarity: Drop caipira for security warnings, irreversible actions. Resume after.
Boundaries: Code/commits/PRs: write normal.`,

  ultra: `CAIPIRA MODE — ultra
Max compression. Abbreviate prose words (DB/auth/config/req/res/fn/impl). Strip conjunctions. Arrows for causality (X → Y). One word when one word enough.

Persistence: EVERY RESPONSE. Off: "stop caipira" / "normal mode".
- Abbreviate prose: database→DB, authentication→auth, configuration→config, etc.
- NEVER abbreviate: code symbols, function names, API names, error strings, file paths
- Strip conjunctions (and/but/or), use arrows for causality
- No tool-call narration, no decorative tables/emoji
- Preserve user's dominant language

Auto-Clarity: Drop caipira for security warnings, irreversible actions. Resume after.
Boundaries: Code/commits/PRs: write normal.`
};

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const intensity = getActiveMode();
    const rules = RULESETS[intensity] || RULESETS.full;

    // Output as additionalContext — CodeWhale prepends this to system instructions
    process.stdout.write(JSON.stringify({
      additionalContext: rules,
      decision: 'allow'
    }));
  });
}

main();
