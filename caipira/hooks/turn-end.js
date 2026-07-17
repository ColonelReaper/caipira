#!/usr/bin/env node
// caipira/hooks/turn-end.js — CodeWhale turn_end hook
// Captures turn summary to caipira memory. Direct SQLite — no CLI subprocess.
//
// Stdin:  {"event":"turn_end","status":"...","error":"...","tool_count":...,"usage":...,"session_id":"..."}

const { MemoryStore } = require('../store');

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch { process.stdout.write(JSON.stringify({})); return; }

    const sessionId = payload.session_id;
    if (!sessionId) { process.stdout.write(JSON.stringify({})); return; }

    try {
      const store = new MemoryStore();

      // Store turn as observation
      const summary = buildSummary(payload);
      if (summary) {
        store.addObservation({
          session_id: sessionId,
          kind: 'turn_end',
          content: summary,
          metadata: {
            status: payload.status,
            tool_count: payload.tool_count,
            error: payload.error ? String(payload.error).slice(0, 200) : null,
            tokens_in: payload.usage?.input_tokens || 0,
            tokens_out: payload.usage?.output_tokens || 0
          }
        });

        // Also store as turn summary
        store.addSummary({
          session_id: sessionId,
          scope: 'turn',
          content: summary
        });
      }

      // Store tool-specific observations
      if (payload.tool_results) {
        for (const tr of payload.tool_results) {
          if (tr.error || (tr.response && tr.response.exitCode !== 0)) {
            store.addObservation({
              session_id: sessionId,
              kind: 'tool_error',
              content: `${tr.tool || 'unknown'}: ${String(tr.error || tr.response?.stderr || 'failed').slice(0, 500)}`,
              metadata: { tool: tr.tool, exitCode: tr.response?.exitCode }
            });
          }
        }
      }

      store.close();
    } catch (err) {
      // silently fail — don't block turn completion
    }

    process.stdout.write(JSON.stringify({}));
  });
}

function buildSummary(payload) {
  const parts = [];

  if (payload.error) {
    parts.push(`Turn error: ${String(payload.error).slice(0, 200)}`);
    return parts.join(' | ');
  }

  if (payload.tool_count > 0) {
    parts.push(`${payload.tool_count} tools`);
  }

  if (payload.usage) {
    const inK = Math.round((payload.usage.input_tokens || 0) / 1000);
    const outK = Math.round((payload.usage.output_tokens || 0) / 1000);
    if (inK > 0) parts.push(`${inK}k→${outK}k tokens`);
  }

  const status = payload.status || 'ok';
  if (status !== 'ok' && status !== 'completed') {
    parts.push(`status=${status}`);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

main();
