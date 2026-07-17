# Caipira v1 — Cross-Session Context

**Built 2026-07-16. Renamed 2026-07-16.** Native CodeWhale memory + compression. No daemon, no worker, no HTTP. Direct SQLite + stdio MCP.

## Purpose

| Layer | What | Files | Token Savings |
|---|---|---|---|
| **Compress** (input) | Shrinks user messages before model sees them | `hooks/caipira-compress.js` (legacy), `caipira/compress.js` (library) | ~30-40% input |
| **Compress** (output) | System prompt tells model to write terse | `AGENTS.md` (CAIPIRA MODE rules) | ~60-75% output |
| **Memory** | Stores turn summaries, errors, context across sessions | `caipira/store.js` + hooks | — |
| **Search** | FTS5 + embedding hybrid search across all sessions | `caipira/mcp.js` | — |

## Files Changed/Created

### New (`~/.codewhale/caipira/`)
```
caipira/
  package.json          # bare — depends on better-sqlite3 (from global npm)
  compress.js           # Port of @cavemem/compress (tokenize, compress, expand)
  store.js              # MemoryStore — SQLite, FTS5, embeddings, hybrid search
  mcp.js                # stdio MCP server — search, get_observations, list_sessions, timeline
  hooks/
    session-start.js    # Creates session in DB
    session-end.js      # Closes session, generates session summary
    turn-end.js         # Captures turn summary + tool errors
    system-inject.js    # Injects caipira rules via additionalContext
```

### Modified
```
~/AGENTS.md            # CAIPIRA MODE rules (workspace root, overrides global .codewhale/AGENTS.md)
.codewhale/AGENTS.md   # References mcp__caipira__search, caipira memory system
hooks.toml             # All hook paths → caipira native paths
mcp.json               # caipira MCP server (node caipira/mcp.js)
hooks/caipira-compress.js  # Renamed from caveman-compress.js, comments updated
```

### Unchanged (still active)
```
hooks/autofix.js            # Auto-repair tool errors
hooks/block-security.js     # Block writes to .env/.pem/etc
hooks/redirect-bash.js      # Suggest native tools over bash
hooks/capture-learning.js   # Record errors to learnings.db
hooks/learnings-command-check.js
hooks/learnings-error-capture.js
```

## How It Works

### Input Compression (every message)
1. User types message
2. `caipira-compress.js` (message_submit hook) runs regex compression
3. Shrunk message goes to model

### Output Compression (every response)
1. `AGENTS.md` injects "CAIPIRA MODE — full" rules into system prompt
2. Model obeys: no articles, no filler, terse fragments
3. `system-inject.js` hook supplements with additionalContext

### Memory (every turn)
1. `session-start.js` creates session row
2. `turn-end.js` captures turn summary (tool count, tokens, errors)
3. Observations compressed via `compress.js` before SQLite INSERT
4. `session-end.js` marks session ended, generates session summary

### Search (on demand)
1. `mcp_caipira_search` tool called
2. MCP server does FTS5 BM25 recall (2x limit)
3. If embedder loaded: cosine similarity rerank (alpha=0.5)
4. Returns ranked results with snippets + scores

### Embedding Backfill (automatic)
1. MCP server loads `Xenova/all-MiniLM-L6-v2` on first search
2. 5s after each MCP call: checks for missing embeddings
3. Backfills up to 50 observations per batch
4. Embeddings stored in `embeddings` table (same DB)

## Verification Commands

```powershell
# Test store
node -e "const {MemoryStore}=require('./caipira/store'); const s=new MemoryStore(); console.log('Obs:', s.countObservations(), 'Sessions:', s.listSessions(3).length); s.close()"

# Test MCP (pipe JSON-RPC)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node .codewhale/caipira/mcp.js

# Test hooks
echo '{"event":"session_start","session_id":"test-123","workspace":"C:\\Users\\luism"}' | node .codewhale/caipira/hooks/session-start.js
```

## What Needs Restart

**CodeWhale restart required** for:
- `mcp.json` changes (caipira MCP server)
- `AGENTS.md` changes (CAIPIRA MODE rules)
- `hooks.toml` changes (new hook paths)

No other restart needed. Hooks are per-session, MCP is per-session.

## Known Issues / Watch Points

1. **MCP embedder loading** — first search call loads `@xenova/transformers` (~2-5s). Subsequent calls are instant. Model stays hot in MCP process memory.

2. **`@xenova/transformers` availability** — must be installed globally. Not bundled — install manually: `npm i -g @xenova/transformers`. Without it, search falls back to FTS5 + LIKE substring matching (no embedding rerank).

3. **better-sqlite3** — must be available globally. Already installed.

4. **DB location** — `~/.caipira/data.db`. Old data from `~/.cavemem/data.db` was migrated.

5. **AGENTS.md advisory** — the caipira rules in AGENTS.md are instructions to the model, not hard system constraints. If model ignores them, the hook `system-inject.js` outputs `additionalContext` which may help. But ultimately the rules rely on model compliance.

6. **FTS5 search** — fresh observations get indexed by SQLite triggers. Multi-word queries use AND logic; falls back to OR substring (LIKE) search when FTS5 returns nothing. If search still returns 0 results, the trigger may have failed silently. Check: `node -e "const {MemoryStore}=require('./caipira/store'); const s=new MemoryStore(); console.log(s.storage.searchFts('test',3)); s.close()"`.

7. **Hook failure** — all hooks have `continue_on_error = true`. If a hook crashes, the session continues. Check CodeWhale logs for hook errors.

## Uninstalling Old cavemem (optional)

The old `cavemem` npm package is no longer needed but harmless to keep. To clean:
```powershell
npm uninstall -g cavemem
```

But `better-sqlite3` and `@xenova/transformers` must stay (used by caipira).

## Session Handoff

If something breaks next session, check:
1. Is caipira MCP registered? Look for `mcp_caipira_search` in available tools
2. Did session_start hook fire? Check `~/.caipira/data.db` for new session row
3. Is embedder loading? MCP server stderr shows `[caipira] embedder loaded:`
4. Are hooks executing? Check `~/.codewhale/logs/tui-*.log` for errors
