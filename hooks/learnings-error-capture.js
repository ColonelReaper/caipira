#!/usr/bin/env node
/**
 * learnings-error-capture.js — tool_call_after hook for CodeWhale
 *
 * Captures failed tool calls to learnings SQLite DB for pattern analysis.
 * Only fires on errors — successful tool calls pass through silently.
 *
 * Detects:
 * - Non-zero exit codes
 * - Stderr containing known error patterns
 * - Command not found / invalid syntax
 *
 * Env:   DEEPSEEK_TOOL_NAME, DEEPSEEK_TOOL_ARGS (JSON)
 * Stdin:  {"event":"tool_call_after","tool_name":"...","tool_response":{...},...}
 * Stdout: (observer-only, always allow)
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.homedir(), '.codewhale', 'learnings.db');

// Error patterns to detect in stderr
const ERROR_PATTERNS = [
  [/command not found/i, 'command-not-found'],
  [/is not recognized as an internal or external command/i, 'command-not-found'],
  [/cannot find module/i, 'module-not-found'],
  [/no such file or directory/i, 'file-not-found'],
  [/access denied|permission denied/i, 'permission'],
  [/syntax error|unexpected token|parsererror/i, 'syntax'],
  [/timed out|timeout/i, 'timeout'],
  [/out of memory/i, 'memory'],
  [/invalid|unknown option|unrecognized/i, 'invalid-option'],
  [/failed|error/i, 'general-error'],
];

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { process.stdout.write(JSON.stringify({ decision: 'allow' })); return; }

    // Enrich from env vars
    if (!payload.tool_name) payload.tool_name = process.env.DEEPSEEK_TOOL_NAME || '';
    if (!payload.tool_input && process.env.DEEPSEEK_TOOL_ARGS) {
      try { payload.tool_input = JSON.parse(process.env.DEEPSEEK_TOOL_ARGS); }
      catch { payload.tool_input = {}; }
    }

    // Only capture errors
    const response = payload.tool_response || {};
    const hasError =
      (response.exitCode && response.exitCode !== 0) ||
      (response.stderr && response.stderr.length > 0) ||
      response.interrupted === true;

    if (!hasError) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }

    // Extract the command that failed
    const command = extractCommand(payload.tool_name, payload.tool_input);
    const stderr = (response.stderr || '').slice(0, 500);
    const category = categorizeError(stderr);

    // Record to learnings DB
    // CHECK constraint requires category IN ('spec_error','spec_incomplete','implementation','discovery','decision','failure')
    // We map all tool errors to 'failure' and use subcategory for the specific error type.
    try {
      const db = new Database(DB_PATH);
      db.prepare(`
        INSERT INTO learnings (category, subcategory, title, description, project, source)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'failure',
        category,
        `${payload.tool_name}: ${command.slice(0, 80)}`,
        JSON.stringify({
          tool: payload.tool_name,
          command,
          stderr: stderr.slice(0, 300),
          exitCode: response.exitCode,
          interrupted: response.interrupted
        }).slice(0, 500),
        'codewhale-integration',
        'auto'
      );
      db.close();
    } catch (err) {
      process.stderr.write(`[learnings-error-capture] DB insert failed: ${err.message}\n`);
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  });
}

function extractCommand(toolName, toolInput) {
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof toolInput.cmd === 'string') return toolInput.cmd;
  if (typeof toolInput.file_path === 'string') return toolInput.file_path;
  if (typeof toolInput.path === 'string') return toolInput.path;
  if (typeof toolInput.url === 'string') return toolInput.url;
  return JSON.stringify(toolInput).slice(0, 200);
}

function categorizeError(stderr) {
  for (const [pattern, category] of ERROR_PATTERNS) {
    if (pattern.test(stderr)) return category;
  }
  return 'command-error';
}

main();
