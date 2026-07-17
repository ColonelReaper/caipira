#!/usr/bin/env node
/**
 * block-security.js — tool_call_before hook for CodeWhale
 *
 * Denies tool calls that would write to sensitive files (.env, .pem, credentials)
 * or commit with attribution (Co-authored-by / Signed-off-by).
 *
 * Env vars: DEEPSEEK_TOOL_NAME, DEEPSEEK_TOOL_ARGS (JSON)
 * Stdin:   hook event payload
 * Stdout:  {"decision":"deny","reason":"..."} or {"decision":"allow"}
 */

const SENSITIVE_PATTERNS = [
  /\.env$/i, /\.env\.[a-z]+$/i,
  /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i,
  /credentials/i, /secret/i, /password/i,
  /\.htpasswd$/i, /\.netrc$/i, /\.npmrc$/i,
  /id_rsa$/i, /id_ed25519$/i, /id_ecdsa$/i,
];

const WRITE_TOOLS = ['Edit', 'Write', 'Bash', 'PowerShell', 'exec_shell'];
const COMMIT_TOOLS = ['Bash', 'PowerShell', 'exec_shell'];

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const toolName = process.env.DEEPSEEK_TOOL_NAME || '';
    const toolArgs = safeParse(process.env.DEEPSEEK_TOOL_ARGS || '{}');

    // ── Block writes to sensitive files ──
    if (WRITE_TOOLS.includes(toolName)) {
      const filePath = extractFilePath(toolName, toolArgs);
      if (filePath && isSensitive(filePath)) {
        deny('Security: cannot write to sensitive file: ' + filePath);
        return;
      }
    }

    // ── Block attribution commits ──
    if (COMMIT_TOOLS.includes(toolName)) {
      const cmdStr = extractCommandString(toolArgs);
      if (cmdStr && /Co-authored-by|Signed-off-by|--signoff/i.test(cmdStr)) {
        deny('Security: attribution commits blocked. Do not add Co-authored-by or Signed-off-by.');
        return;
      }
    }

    // ── Allow ──
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  });
}

function extractFilePath(toolName, args) {
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file_path === 'string') return args.file_path;
  if (typeof args.file === 'string') return args.file;
  // Bash/PowerShell: check command for file paths
  const cmd = args.command || args.cmd || '';
  const match = cmd.match(/(?:>>|>)\s*(\S+)/);
  if (match) return match[1];
  return null;
}

function extractCommandString(args) {
  return args.command || args.cmd || args.script || JSON.stringify(args);
}

function isSensitive(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  return SENSITIVE_PATTERNS.some(p => p.test(name) || p.test(filePath));
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
  process.exit(0);
}

main();
