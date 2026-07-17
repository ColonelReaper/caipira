#!/usr/bin/env node
// caipira/hooks/system-inject.js — CodeWhale session_start hook
// Injects compressed-response examples (few-shot) into system context.
// Experiment proved: few-shot examples → 55% output reduction
// vs 22% from abstract CAIPIRA MODE rules.

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

// Few-shot examples — the model learns the output style from these
const FEWSHOT = {
  lite: `Reply in compressed style. Strip filler words but keep full sentences. Examples:

Q: how do I set up a reverse proxy with nginx for a node app?
A: Create nginx server block with location / proxy_pass to http://localhost:3000. Set Host header. Reload.

Q: explain the difference between a thread and a process
A: Process: independent execution unit, own memory space. Thread: lightweight unit within a process, shares memory. OS schedules threads, not processes.

Reply in this exact style. Code blocks stay normal.`,

  full: `Reply terse. Drop articles and filler. Fragments OK. Examples:

Q: how configure nginx reverse proxy for node app on port 3000?
A: nginx server block → location / → proxy_pass http://localhost:3000. Set proxy_set_header Host. Reload.

Q: diff btwn thread and process?
A: Process: own memory, heavy. Thread: shares memory, light. OS schedules threads. IPC needed for processes, not threads.

Q: git remove commits from history safely?
A: git rebase -i HEAD~N → mark commits drop/squash. Or git reset --soft HEAD~N for recent. Force push after: git push --force-with-lease. Backup branch first.

Reply in this exact compressed style. No articles. Fragments. Code blocks stay normal.`,

  ultra: `Reply ultra-compressed. Abbreviate prose (DB/auth/config/fn/impl). Strip conjunctions. Arrows for causality. Examples:

Q: how cfg nginx reverse proxy node app port 3000?
A: nginx srv block → loc / → proxy_pass http://localhost:3000. Set proxy_set_header Host. Reload.

Q: diff btwn thread & process?
A: Process: own mem, heavy, IPC. Thread: shared mem, light, same addr space. OS schedules threads.

Q: SQL top 5 customers by order val last 30 days?
A: SELECT c.id, c.name, SUM(o.total) FROM customers c JOIN orders o ON c.id = o.customer_id WHERE o.created_at >= NOW() - INTERVAL '30 days' GROUP BY c.id, c.name ORDER BY SUM(o.total) DESC LIMIT 5;

Q: git remove commits from history?
A: git rebase -i HEAD~N → mark commits drop/squash → git push --force-with-lease. Backup branch first.

Reply in this exact style. Abbreviate prose words. NEVER abbreviate code/identifiers/API names/error strings/file paths. Code blocks stay normal.`
};

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const intensity = getActiveMode();
    const rules = FEWSHOT[intensity] || FEWSHOT.full;

    process.stdout.write(JSON.stringify({
      additionalContext: rules,
      decision: 'allow'
    }));
  });
}

main();
