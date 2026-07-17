#!/usr/bin/env node
/**
 * capture-learning.js — turn_end hook for CodeWhale
 *
 * After each turn, records observations to the learnings SQLite DB.
 * Detects errors, tool failures, and interesting patterns.
 *
 * Stdin:  {"event":"turn_end","status":"...","error":"...","usage":{...},"tool_count":...}
 * Stdout: (ignored — observer-only)
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return; }

    const dbPath = path.join(os.homedir(), '.codewhale', 'learnings.db');
    let db;
    try { db = new Database(dbPath); }
    catch { return; }

    try {
      // Record turn errors
      if (payload.error) {
        db.prepare(`INSERT OR IGNORE INTO learnings (category, title, description, project, source)
         VALUES (?, ?, ?, ?, ?)`).run(
          'failure',
          'Turn error: ' + (payload.error || 'unknown').slice(0, 100),
          payload.error.slice(0, 500),
          'codewhale-integration',
          'auto'
        );
      }

      // Record failed turn (non-ok status)
      if (payload.status && payload.status !== 'ok' && payload.status !== 'completed') {
        db.prepare(`INSERT OR IGNORE INTO learnings (category, title, description, project, source)
         VALUES (?, ?, ?, ?, ?)`).run(
          'failure',
          'Turn ' + payload.status + ': ' + (payload.error || 'no details').slice(0, 100),
          JSON.stringify({ status: payload.status, error: payload.error, tool_count: payload.tool_count }).slice(0, 500),
          'codewhale-integration',
          'auto'
        );
      }

      // Record high-token turns (potential for compression optimization)
      if (payload.usage && payload.usage.input_tokens > 50000) {
        db.prepare(`INSERT OR IGNORE INTO learnings (category, title, description, project, source)
         VALUES (?, ?, ?, ?, ?)`).run(
          'implementation',
          'High token turn: ' + payload.usage.input_tokens + ' input tokens',
          JSON.stringify({ input_tokens: payload.usage.input_tokens, output_tokens: payload.usage.output_tokens, tool_count: payload.tool_count }).slice(0, 300),
          'codewhale-integration',
          'auto'
        );
      }
    } finally {
      db.close();
    }
  });
}

main();
