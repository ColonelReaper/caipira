#!/usr/bin/env node
/**
 * learnings-command-check.js — tool_call_before hook for CodeWhale
 *
 * Before executing a tool call, checks the learnings DB for similar
 * commands that failed in the past. If a known-good correction exists,
 * applies it automatically — saving tokens from re-attempts.
 *
 * Also checks command-corrections.json for fast cached corrections.
 *
 * Env:   DEEPSEEK_TOOL_NAME, DEEPSEEK_TOOL_ARGS (JSON)
 * Stdin:  {"event":"tool_call_before","tool_name":"...","tool_input":{...},...}
 * Stdout: {"decision":"allow"} or {"decision":"allow","modified_input":{...}}
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(os.homedir(), '.codewhale', 'learnings.db');
const CORRECTIONS_PATH = path.join(os.homedir(), '.claude', 'hooks', 'command-corrections.json');

// Known standard corrections (always applied)
const STATIC_CORRECTIONS = {
  // Windows: prefer node over node.exe
  node: { pattern: /\bnode\.exe\b/, replace: 'node' },
  // PowerShell: semicolons not &&
  pwsh: { pattern: /&&/g, replace: ';' },
};

function main() {
  const toolName = process.env.DEEPSEEK_TOOL_NAME || '';
  let toolInput = {};

  // Only check executable tools
  if (!['Bash', 'exec_shell', 'PowerShell'].includes(toolName)) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { process.stdout.write(JSON.stringify({ decision: 'allow' })); return; }

    toolInput = payload.tool_input || safeParse(process.env.DEEPSEEK_TOOL_ARGS || '{}');
    const command = extractCommand(toolInput);

    if (!command) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }

    let corrected = command;

    // 1. Apply static corrections
    corrected = applyStatic(corrected, toolName);

    // 2. Check SQLite learnings DB for known fixes
    corrected = applyLearningsCorrections(corrected, toolName);

    // 3. Check command-corrections.json cache
    corrected = applyCachedCorrections(corrected);

    // If command was modified, return updated input
    if (corrected !== command) {
      const newInput = { ...toolInput };
      if (newInput.command) newInput.command = corrected;
      else if (newInput.cmd) newInput.cmd = corrected;

      process.stdout.write(JSON.stringify({
        decision: 'allow',
        modified_input: newInput,
        additionalContext: `Command corrected from previous errors: "${command.slice(0, 80)}" → "${corrected.slice(0, 80)}"`
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  });
}

function extractCommand(toolInput) {
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof toolInput.cmd === 'string') return toolInput.cmd;
  return null;
}

function applyStatic(command, toolName) {
  let result = command;

  // PowerShell: replace && with ;
  if (toolName === 'PowerShell') {
    result = result.replace(/&&/g, ';');
  }

  // Any tool: node.exe → node
  result = result.replace(/\bnode\.exe\b/g, 'node');

  return result;
}

function applyLearningsCorrections(command, toolName) {
  try {
    if (!fs.existsSync(DB_PATH)) return command;

    const db = new Database(DB_PATH);
    // Find similar commands that failed and have corrections
    const rows = db.prepare(`
      SELECT description FROM learnings
      WHERE category LIKE '%error%'
        AND description LIKE ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(`%${toolName}%`);

    db.close();

    let result = command;
    for (const row of rows) {
      try {
        const data = JSON.parse(row.description);
        if (data.command && data.command === command && data.correction) {
          result = data.correction;
          break;
        }
      } catch {}
    }

    return result;
  } catch {
    return command;
  }
}

function applyCachedCorrections(command) {
  try {
    if (!fs.existsSync(CORRECTIONS_PATH)) return command;
    const cache = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8'));
    const corrections = cache.corrections || {};

    for (const [badPattern, correction] of Object.entries(corrections)) {
      if (command.includes(badPattern)) {
        return command.replace(new RegExp(badPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), correction);
      }
    }
  } catch {}
  return command;
}

function safeParse(str) {
  try { return JSON.parse(str); }
  catch { return {}; }
}

main();
