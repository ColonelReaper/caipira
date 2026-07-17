#!/usr/bin/env node
/**
 * redirect-bash.js — tool_call_before hook for CodeWhale
 *
 * When Bash/PowerShell is called with commands that have native CodeWhale
 * equivalents (cat → Read, grep → Grep, find → Glob/file_search, ls → list_dir),
 * adds additionalContext suggesting the native tool instead.
 *
 * Does NOT block — only suggests.
 *
 * Stdout: {"decision":"allow","additionalContext":"Tip: use Read instead of cat"} or {"decision":"allow"}
 */

const REDIRECTS = {
  cat:    { tool: 'Read / read_file', reason: 'faster and skips approval prompt' },
  grep:   { tool: 'Grep / grep_files', reason: 'pure-Rust, respects .gitignore, faster' },
  find:   { tool: 'Glob / file_search', reason: 'fuzzy matching with score-based ranking' },
  ls:     { tool: 'list_dir', reason: 'faster and properly decoded' },
  'ls -la': { tool: 'list_dir', reason: 'faster and properly decoded' },
  head:   { tool: 'read_file (with max_lines)', reason: 'no subshell overhead' },
  tail:   { tool: 'read_file (with start_line)', reason: 'no subshell overhead' },
  sed:    { tool: 'edit_file or apply_patch', reason: 'safer, transactional, diff rendering' },
  awk:    { tool: 'Grep or a scripting language', reason: 'CodeWhale native tools handle structured data better' },
  curl:   { tool: 'fetch_url or web_search', reason: 'sandboxed, network-policy aware' },
  wget:   { tool: 'fetch_url', reason: 'sandboxed, network-policy aware' },
};

function main() {
  const toolName = process.env.DEEPSEEK_TOOL_NAME || '';

  // Only fire for Bash or PowerShell
  if (toolName !== 'Bash' && toolName !== 'PowerShell' && toolName !== 'exec_shell') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { input = {}; }
    let toolArgs;
    try { toolArgs = JSON.parse(process.env.DEEPSEEK_TOOL_ARGS || '{}'); } catch { toolArgs = {}; }

    const cmd = (toolArgs.command || '').trim();
    if (!cmd) { allow(); return; }

    // Check for redirectable commands
    for (const [pattern, suggestion] of Object.entries(REDIRECTS)) {
      if (cmd.startsWith(pattern + ' ') || cmd === pattern) {
        process.stdout.write(JSON.stringify({
          decision: 'allow',
          additionalContext: `Tip: CodeWhale has a native ${suggestion.tool} tool — ${suggestion.reason}. Consider using it instead of \`${pattern}\` in Bash.`
        }));
        return;
      }
    }

    // Check for piped grep patterns: `... | grep`
    if (/\|\s*grep\b/.test(cmd)) {
      process.stdout.write(JSON.stringify({
        decision: 'allow',
        additionalContext: 'Tip: CodeWhale\'s Grep tool handles piped grep patterns natively. Consider refactoring this command.'
      }));
      return;
    }

    allow();
  });
}

function allow() {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}

main();
