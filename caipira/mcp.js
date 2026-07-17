#!/usr/bin/env node
// caipira/mcp.js — stdio MCP server with embedding-powered search
// Loads @xenova/transformers lazily. Backfills embeddings on idle.
// Tools: search, get_observations, list_sessions, timeline

const { MemoryStore } = require('./store');
const path = require('path');
const os = require('os');

let store = null;
let embedder = null;
let backfillTimer = null;

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const MODEL_DIM = 384;

// ── Embedder (lazy, cached) ──

async function getEmbedder() {
  if (embedder) return embedder;
  const transformers = require('@xenova/transformers');
  const cacheDir = path.join(os.homedir(), '.caipira', 'models');
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowLocalModels = true;
  const extractor = await transformers.pipeline('feature-extraction', MODEL, { quantized: true });

  embedder = {
    model: MODEL,
    dim: MODEL_DIM,
    embed: async (text) => {
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      return new Float32Array(out.data);
    }
  };
  console.error('[caipira] embedder loaded:', MODEL);
  return embedder;
}

// ── Backfill ──

async function backfillMissing() {
  if (!store) return;
  const missing = store.observationsMissingEmbeddings(50, MODEL);
  if (missing.length === 0) return;

  const emb = await getEmbedder();
  let count = 0;
  for (const obs of missing) {
    try {
      const vec = await emb.embed(obs.content);
      store.putEmbedding(obs.id, MODEL, vec);
      count++;
    } catch (e) {
      console.error('[caipira] embed failed for obs', obs.id, ':', e.message);
    }
  }
  if (count > 0) console.error(`[caipira] backfilled ${count} embeddings`);
}

function scheduleBackfill() {
  if (backfillTimer) clearTimeout(backfillTimer);
  backfillTimer = setTimeout(() => {
    backfillMissing().catch(e => console.error('[caipira] backfill error:', e.message));
  }, 5000); // 5s after last activity
}

// ── MCP protocol ──

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handle(msg);
    } catch (e) {
      respond(null, { code: -32700, message: 'Parse error: ' + e.message });
    }
  }
});

function respond(id, result) {
  const msg = { jsonrpc: '2.0', id };
  if (result && result.code) {
    msg.error = result;
  } else {
    msg.result = result;
  }
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  scheduleBackfill();

  switch (method) {
    case 'initialize':
      store = new MemoryStore();
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'caipira', version: '2.0.0' }
      });
      break;

    case 'notifications/initialized':
      break;

    case 'tools/list':
      respond(id, {
        tools: [
          {
            name: 'search',
            description: 'Search caipira memory across sessions using hybrid FTS5 + embedding search. Multi-word queries require ALL terms (AND logic); falls back to substring OR search if FTS5 returns nothing. For broad recall, use single keywords. Returns relevant observations with snippets and scores.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search terms. Multi-word = AND (all must match). Falls back to OR substring search when no FTS5 hits. Prefer 1-3 keywords for best results.' },
                limit: { type: 'number', description: 'Max results (default 10)', default: 10 }
              },
              required: ['query']
            }
          },
          {
            name: 'get_observations',
            description: 'Retrieve specific observations by their IDs, optionally expanding compressed content.',
            inputSchema: {
              type: 'object',
              properties: {
                ids: { type: 'array', items: { type: 'number' }, description: 'Observation IDs to retrieve' },
                expand: { type: 'boolean', description: 'Expand compressed abbreviations (default false)' }
              },
              required: ['ids']
            }
          },
          {
            name: 'list_sessions',
            description: 'List recent sessions with their metadata.',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { type: 'number', description: 'Max sessions (default 20)', default: 20 }
              }
            }
          },
          {
            name: 'timeline',
            description: 'Get timeline of observations for a session.',
            inputSchema: {
              type: 'object',
              properties: {
                session_id: { type: 'string', description: 'Session ID' },
                limit: { type: 'number', description: 'Max results (default 20)', default: 20 }
              },
              required: ['session_id']
            }
          }
        ]
      });
      break;

    case 'tools/call':
      await handleToolCall(id, params);
      break;

    default:
      respond(id, { code: -32601, message: `Method not found: ${method}` });
  }
}

async function handleToolCall(id, params) {
  if (!store) store = new MemoryStore();
  const { name, arguments: args } = params;

  try {
    let result;
    switch (name) {
      case 'search': {
        const emb = await getEmbedder().catch(() => null);
        const hits = await store.search(args.query, args.limit || 10, emb);
        result = { content: [{ type: 'text', text: JSON.stringify(hits) }] };
        break;
      }
      case 'get_observations': {
        const rows = store.getObservations(args.ids, { expand: args.expand ?? false });
        result = { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        break;
      }
      case 'list_sessions': {
        const sessions = store.listSessions(args.limit || 20);
        result = { content: [{ type: 'text', text: JSON.stringify(sessions) }] };
        break;
      }
      case 'timeline': {
        const rows = store.timeline(args.session_id, null, args.limit || 20);
        result = { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        break;
      }
      default:
        respond(id, { code: -32601, message: `Unknown tool: ${name}` });
        return;
    }
    respond(id, result);
  } catch (err) {
    respond(id, { code: -32000, message: `Tool error: ${err.message}` });
  }
}

process.on('SIGTERM', () => { if (store) store.close(); process.exit(0); });
process.on('SIGINT', () => { if (store) store.close(); process.exit(0); });
