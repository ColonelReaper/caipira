# CodeWhale Config — Portable Setup

Clone this repo into `~/.codewhale/` on any machine to replicate the full
CodeWhale configuration: hooks, MCP servers, caipira memory system, skills, and
agent profiles.

## Quick Install

```powershell
# 1. Clone into .codewhale
git clone https://github.com/ColonelReaper/caipira.git $env:USERPROFILE\.codewhale

# 2. Install Node dependencies
cd $env:USERPROFILE\.codewhale\caipira
npm install

# 3. Install global deps (if not already installed)
npm install -g better-sqlite3 @xenova/transformers madar

# 4. Restart CodeWhale
```

## What's Included

| Component | Description |
|---|---|
| **caipira** | Native memory + compression (SQLite FTS5, MCP server, no daemon) |
| **hooks** | Message compression, security blocks, bash redirects, auto-fix, learnings |
| **madar** | Knowledge graph MCP for codebase navigation |
| **skills** | 12 built-in skills (documents, pdf, spreadsheets, presentations, etc.) |
| **agents** | Builder and manager agent profiles |

## Dependencies

- **Node.js** ≥ 18
- **better-sqlite3** — global or local to `caipira/`
- **@xenova/transformers** — global, for embedding search (optional; falls back to FTS5)
- **madar** — global, for codebase graph navigation

## Post-Install

After cloning and running `npm install`, restart CodeWhale. The new hooks and
MCP servers load on restart.

### Verify

```powershell
# Test caipira store
node -e "const {MemoryStore}=require('./caipira/store'); const s=new MemoryStore(); console.log('Obs:', s.countObservations()); s.close()"

# Test MCP server starts
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node .codewhale/caipira/mcp.js
```

## Path Notes

All paths in `hooks.toml` and `mcp.json` are relative to the `.codewhale/`
directory. CodeWhale resolves these relative to the config directory at runtime.
If hooks fail to start after cloning, verify that CodeWhale sets the working
directory to `.codewhale/` when spawning hook processes.

## Updating

```powershell
cd $env:USERPROFILE\.codewhale
git pull
cd caipira && npm install
# Restart CodeWhale
```
