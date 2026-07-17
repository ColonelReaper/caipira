# CodeWhale Global Rules — VoltPag & All Projects

## 1. Caipira Memory System — Cross-Session Source of Truth

This environment has a **caipira** persistent memory layer via MCP. You MUST use it:

- **At session start**, call `mcp__caipira__search` to retrieve context from past sessions — what was being worked on, decisions made, pitfalls encountered.
- **Before any code change**, check `mcp__caipira__search` for relevant prior observations.
- **After completing significant work**, call `mcp__caipira__get_observations` and add new observations so the next session picks up where you left off.
- caipira replaces HANDOFF.md. It is the cross-session source of truth. Do NOT rely on your context window alone.

## 2. madar Knowledge Graph — Navigate Codebases Instantly

When working inside a project with `graph.json` (voltPag, ofira-core, pumpy):

- **For codebase questions, use madar first**: `mcp__madar__retrieve` for search, `mcp__madar__impact` for blast radius, `mcp__madar__call_chain` for dependency paths.
- **After modifying code**, rebuild the graph to keep it current.
- madar surfaces structural relationships invisible to grep. Use it before reading files blindly.
- Only skip madar if the graph file doesn't exist or is known stale.

## 3. No Guessing — Verify Before Acting

You MUST NOT guess file paths, module names, or API signatures. Follow this order:

1. **Search memory first**: `mcp__caipira__search` for existing knowledge
2. **Check the graph**: `mcp__madar__retrieve` for codebase structure
3. **Verify paths**: confirm a file exists before reading or editing it
4. **Verify structure**: read file headers/imports before assuming exports
5. **Only then**: make changes

NEVER:
- Invent file paths that don't exist
- Assume function signatures without verifying
- Write code based on "patterns you've seen" without reading the actual file
- Change files that weren't explicitly requested

## 4. Scope Discipline

- Only modify files within the project scope you were asked about.
- If a change would affect files in another project (e.g., changing ofira-core while working in pumpy), ask for confirmation.
- Do not "improve" code unrelated to the task without explicit permission.

## 5. Subagent Delegation — CodeWhale Native

For complex multi-step work, use CodeWhale's native agent system:

| Agent Type | Use For |
|---|---|
| `type: "explore"` | Codebase scouting, file location, research (uses faster model) |
| `type: "implementer"` | Surgical 1-2 file edits |
| `type: "review"` | Diff review, bug hunting, spec-compliance verification |
| `type: "plan"` | Task decomposition, dependency ordering |

- Prefer parallel scouts for independent investigations — they run simultaneously.
- Use `agent(profile="guardian", ...)` for SDD spec-compliance verification (see SDD rules).
- Brief sub-agents compactly: QUESTION, SCOPE, ALREADY_KNOWN, EFFORT, STOP_CONDITION, OUTPUT.

## 6. SDD Flow — Orchestrator Only

When running SDD (Spec-Driven Development) pipelines:

- **Orchestrate, don't implement.** Delegate implementation to sub-agents.
- Spawn `maestro` (planner) → decompose spec into task board.
- Spawn implementer workers → one per task.
- Spawn `guardian` (verifier) → verify every worker output against spec.
- Spawn `scribe` → sync documentation after changes.
- **Do NOT edit files directly during SDD.** Workers edit. You orchestrate.

## 7. VoltPag Project Reference

See `Documents/voltPag/CLAUDE.md` for project-specific rules (SQLAlchemy ORM-only, Docker testing, port map, agent definitions).

## 8. graphify (Legacy / Fallback)

For projects using graphify instead of madar:
- `graphify query "<question>"` for codebase traversal
- `graphify path "<A>" "<B>"` for structural relationships
- `graphify explain "<concept>"` for focused exploration
- After modifying code, run `graphify update .` to keep the graph current
