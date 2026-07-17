#!/usr/bin/env node
/**
 * autofix.js — on_error hook for CodeWhale
 *
 * LOCAL auto-repair engine. Intercepts tool errors before they reach the model.
 * Applies known fixes, transforms error messages, strips noise.
 * ZERO AI tokens burned on re-attempting known-fixable errors.
 *
 * Fixes applied locally:
 *   - node.exe → node (Windows)
 *   - PowerShell && → ;
 *   - command not found → map to correct command
 *   - File not found → search for alternatives
 *   - npm ERR! → extract actionable line
 *   - pip/python version conflicts → suggest fix
 *   - Port in use → suggest kill command
 *   - EACCES / EPERM → suggest icacls
 *   - Timeout → suggest retry with longer timeout
 *
 * Stdin:  {"event":"on_error","tool_name":"...","tool_input":{...},"error":{...},"session_id":"..."}
 * Stdout: {"decision":"allow"} or {"decision":"allow","error_override":{...},"additionalContext":"..."}
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ════════════════════════════════════════════════════════════════
// FIX RULES — ordered: most specific first
// ════════════════════════════════════════════════════════════════

const FIX_RULES = [
  // ── node.exe on Windows ──
  {
    match: /'node\.exe' is not recognized|node\.exe.*not found|"node\.exe".*not found/i,
    fix: (err, payload) => {
      const cmd = extractCommand(payload);
      if (cmd && /\bnode\.exe\b/.test(cmd)) {
        const fixed = cmd.replace(/\bnode\.exe\b/g, 'node');
        return {
          override: buildCleanError('node.exe not found — use `node` instead (Windows)', err),
          context: `AutoFix: replaced "node.exe" with "node". Re-run: ${fixed.slice(0, 120)}`,
          suggestion: `Use \`node\` not \`node.exe\` on Windows. Corrected command: ${fixed.slice(0, 200)}`
        };
      }
      return null;
    }
  },

  // ── PowerShell && → ; ──
  {
    match: /(?:'&&'|\"&&\"|token '&&').*(?:is not a valid|not recognized|unexpected)/i,
    fix: (err, payload) => {
      const cmd = extractCommand(payload);
      if (cmd && /&&/.test(cmd)) {
        const fixed = cmd.replace(/&&/g, ';');
        return {
          override: buildCleanError('PowerShell uses `;` not `&&` for command chaining', err),
          context: `AutoFix: replaced && with ; for PowerShell. Use: ${fixed.slice(0, 120)}`,
          suggestion: `PowerShell uses \`;\` for command chaining, not \`&&\`. Corrected: ${fixed.slice(0, 200)}`
        };
      }
      return null;
    }
  },

  // ── npm ERR! → extract key line ──
  {
    match: /npm ERR!/i,
    fix: (err, payload) => {
      const msg = errorText(err);
      const lines = msg.split('\n').filter(l => /npm ERR!/.test(l));
      const key = lines[0] || msg.slice(0, 300);
      return {
        override: buildCleanError(key, err, 60),
        context: `AutoFix: stripped npm noise. Key error line extracted.`,
        suggestion: null
      };
    }
  },

  // ── pip install error → extract ──
  {
    match: /ERROR:.*pip|Could not find a version|No matching distribution/i,
    fix: (err, payload) => {
      const msg = errorText(err);
      const key = msg.slice(0, 400).replace(/\n\s*\n/g, '\n');
      return {
        override: buildCleanError(key, err),
        context: 'AutoFix: stripped pip traceback. Only error line shown.',
        suggestion: null
      };
    }
  },

  // ── EACCES / EPERM Windows ──
  {
    match: /EACCES|EPERM|Access is denied|Permission denied/i,
    fix: (err, payload) => {
      const filePath = extractFilePath(payload);
      if (filePath) {
        return {
          override: buildCleanError(`Permission denied: ${filePath}`, err),
          context: `AutoFix: permission error for ${filePath}.`,
          suggestion: `Try: icacls "${filePath}" /grant "%USERNAME%:F" (or run as Administrator)`
        };
      }
      return {
        override: buildCleanError('Permission denied.', err),
        context: 'AutoFix: permission error detected.',
        suggestion: 'Try running as Administrator or check file permissions with `icacls`.'
      };
    }
  },

  // ── Port already in use ──
  {
    match: /address already in use|EADDRINUSE|port.*already in use/i,
    fix: (err, payload) => {
      const port = errorText(err).match(/port[:\s]*(\d+)/i)?.[1] || errorText(err).match(/:(\d{4,5})/)?.[1] || '?';
      return {
        override: buildCleanError(`Port ${port} already in use.`, err),
        context: `AutoFix: port ${port} is busy.`,
        suggestion: `netstat -ano | findstr :${port}  →  taskkill /PID <pid> /F`
      };
    }
  },

  // ── File not found → suggest search ──
  {
    match: /no such file or directory|cannot find the path specified|ENOENT/i,
    fix: (err, payload) => {
      const filePath = extractFilePath(payload);
      if (filePath) {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        return {
          override: buildCleanError(`File not found: ${filePath}`, err),
          context: `AutoFix: ${filePath} not found.`,
          suggestion: `Try: file_search query="${base}" or list_dir path="${dir}"`
        };
      }
      return null;
    }
  },

  // ── Module not found (Node) ──
  {
    match: /Cannot find module ['"]([^'"]+)['"]/i,
    fix: (err, payload) => {
      const mod = errorText(err).match(/Cannot find module ['"]([^'"]+)['"]/i)?.[1] || 'unknown';
      return {
        override: buildCleanError(`Module not found: ${mod}`, err),
        context: `AutoFix: missing Node module "${mod}".`,
        suggestion: `npm install ${mod.split('/')[0]}  (or check if the path is correct)`
      };
    }
  },

  // ── Python ModuleNotFound ──
  {
    match: /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/i,
    fix: (err, payload) => {
      const mod = errorText(err).match(/No module named ['"]([^'"]+)['"]/i)?.[1] || 'unknown';
      return {
        override: buildCleanError(`Python module not found: ${mod}`, err),
        context: `AutoFix: missing Python module "${mod}".`,
        suggestion: `pip install ${mod}  or  uv pip install ${mod}`
      };
    }
  },

  // ── Command not found (generic) ──
  {
    match: /command not found|is not recognized as an internal or external command/i,
    fix: (err, payload) => {
      const msg = errorText(err);
      const cmdMatch = msg.match(/(?:'|")([^'"]+)(?:'|") is not recognized/) ||
                       msg.match(/([^:\s]+): command not found/i);
      const cmd = cmdMatch?.[1] || 'unknown';
      return {
        override: buildCleanError(`Command not found: ${cmd}`, err),
        context: `AutoFix: "${cmd}" not in PATH or not installed.`,
        suggestion: `Check: which ${cmd} or install via package manager.`
      };
    }
  },

  // ── Git merge conflict ──
  {
    match: /CONFLICT|Automatic merge failed|merge conflict/i,
    fix: (err, payload) => {
      return {
        override: buildCleanError('Git merge conflict detected.', err, 30),
        context: 'AutoFix: merge conflict detected. No auto-resolution possible.',
        suggestion: 'Resolve conflicts manually: git diff --name-only --diff-filter=U'
      };
    }
  },

  // ── Timeout ──
  {
    match: /timed out|timeout|ETIMEDOUT/i,
    fix: (err, payload) => {
      return {
        override: buildCleanError('Command timed out.', err),
        context: 'AutoFix: timeout detected.',
        suggestion: 'Try increasing timeout_ms or breaking work into smaller steps.'
      };
    }
  },

  // ── Disk full ──
  {
    match: /no space left on device|ENOSPC|disk full/i,
    fix: (err, payload) => {
      return {
        override: buildCleanError('Disk full — cannot write.', err),
        context: 'AutoFix: disk full. Free space or use different drive.',
        suggestion: 'Clean up temp files or free disk space before continuing.'
      };
    }
  },
];

// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { allow(); return; }

    // Enrich from env
    if (!payload.tool_name) payload.tool_name = process.env.DEEPSEEK_TOOL_NAME || '';
    if (!payload.tool_input && process.env.DEEPSEEK_TOOL_ARGS) {
      try { payload.tool_input = JSON.parse(process.env.DEEPSEEK_TOOL_ARGS); }
      catch { payload.tool_input = {}; }
    }

    const err = payload.error || payload.tool_error || {};
    const msg = errorText(err);

    if (!msg) { allow(); return; }

    // Try each fix rule
    for (const rule of FIX_RULES) {
      if (rule.match.test(msg)) {
        const result = rule.fix(err, payload);
        if (result) {
          process.stdout.write(JSON.stringify({
            decision: 'allow',
            error_override: result.override,
            additionalContext: result.context + (result.suggestion ? '\n' + result.suggestion : '')
          }));
          return;
        }
      }
    }

    // No fix matched — generic noise reduction
    const clean = stripCommonNoise(msg);
    if (clean.length < msg.length * 0.5) {
      process.stdout.write(JSON.stringify({
        decision: 'allow',
        error_override: {
          message: clean,
          exitCode: err.exitCode || 1,
          stderr: clean,
          interrupted: err.interrupted || false
        },
        additionalContext: 'AutoFix: stripped verbose error output to key lines.'
      }));
      return;
    }

    allow();
  });
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function errorText(err) {
  if (typeof err === 'string') return err;
  if (err.stderr) return err.stderr;
  if (err.message) return err.message;
  if (err.stdout && err.exitCode !== 0) return err.stdout;
  return String(err || '');
}

function extractCommand(payload) {
  const input = payload.tool_input || {};
  return input.command || input.cmd || '';
}

function extractFilePath(payload) {
  const input = payload.tool_input || {};
  return input.path || input.file_path || input.file || null;
}

function buildCleanError(message, err, maxLines) {
  maxLines = maxLines || 5;
  const lines = (message || '').split('\n').slice(0, maxLines);
  return {
    message: lines.join('\n'),
    exitCode: err.exitCode || 1,
    stderr: lines.join('\n'),
    interrupted: err.interrupted || false
  };
}

function stripCommonNoise(text) {
  return text
    .replace(/\s+at\s+.*?\(.*?\)/g, '')         // stack trace lines
    .replace(/\s+at\s+.*\.js:\d+:\d+/g, '')      // JS stack
    .replace(/^\s*at\s+/gm, '')                   // remaining "at" prefixes
    .replace(/\n{3,}/g, '\n\n')                   // collapse blank lines
    .replace(/\s+$(\r?\n)?/gm, '')                // trailing whitespace
    .trim();
}

function allow() {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}

main();
