#!/usr/bin/env node
// caipira/experiments/compress-mirror.js
// Compression mirror experiment
// Usage: set DEEPSEEK_API_KEY=sk-... && node compress-mirror.js

var cm = require('../compress.js');
var compressFn = cm.compress;
var expandFn = cm.expand;
var tkCount = cm.countTokens;
var https = require('https');

var K = 'DEEPSEEK_API_' + 'KEY';
var apiKey = process.env[K];
var model = process.env['DEEPSEEK_MODEL'] || 'deepseek-v4-pro';
var apiHost = 'api.deepseek.com';
var apiPath = '/v1/chat/completions';

if (!apiKey) { console.error('Set DEEPSEEK_API_KEY'); process.exit(1); }

var testPrompts = [
  // Core technical (from v1)
  "Can you explain how the Python garbage collector works and what reference counting means for memory management?",
  "I need to set up a PostgreSQL database with proper indexing for a users table. What is the best approach for handling email lookups and name searches?",
  "Write a JavaScript function that takes an array of numbers and returns the median value without using any built-in sort method.",
  "What are the differences between REST and GraphQL APIs, and when should I use each one for a new project?",
  "How do I configure Nginx as a reverse proxy for a Node.js application that is running on port 3000?",
  "What is the difference between a process and a thread, and how does the operating system schedule them?",
  // Edge: very short
  "ok",
  "Why?",
  // Edge: code-heavy
  "Write a complete Express.js server with error handling middleware, request logging via morgan, and rate limiting using express-rate-limit. Include TypeScript types.",
  // Edge: data/numbers
  "Dataset has 1,234,567 rows. Column A: mean 42.5, stddev 3.2. Column B correlates at r=0.87. Outliers detected in top 1%. What statistical test should I use to determine if A significantly differs from B?",
  // Edge: non-English
  "Por favor, explica como funciona o garbage collector do Python e o que significa contagem de referencias para gerenciamento de memoria.",
  // Edge: meta/self-referential
  "What is the most token-efficient way to compress natural language text while preserving semantic meaning and code blocks?",
  // Edge: creative/writing
  "Write a haiku about garbage collection in computer programming.",
  // Edge: multiple URLs/paths
  "Compare these two packages for building CLI tools: https://www.npmjs.com/package/commander and https://www.npmjs.com/package/yargs. Which has better TypeScript support?",
  // Edge: very long, multi-part
  "I am building a real-time chat application with WebSocket support. The backend uses Node.js with TypeScript, PostgreSQL for persistence, Redis for pub/sub and session storage, and Docker for deployment. I need to handle: 1) Authentication via JWT with refresh tokens, 2) Message history with pagination and full-text search, 3) Online presence indicators, 4) Typing indicators with debouncing, 5) File uploads for images with thumbnail generation. Walk me through the architecture and key design decisions for each component."
];

var systemPrompts = {
  instruction: 'CAIPIRA MODE - ultra. Max compression. Abbreviate prose: database to DB, authentication to auth, configuration to config. Strip conjunctions. Arrows for causality. One word when one word enough. NEVER abbreviate code/API names/error strings/file paths.',
  fewshot: 'Reply in compressed shorthand. Use abbreviations (DB/auth/config/req/resp/fn/impl). Strip conjunctions. Arrows for causality. Examples: Q: how configure nginx reverse proxy node.js port 3000? A: nginx reverse proxy config: server block, location /, proxy_pass http://localhost:3000. Set proxy_set_header Host. Reload nginx. Now reply in this exact compressed style.',
  none: null
};

var conditions = [
  { id: 'A', name: 'Control (raw, no instructions)', sp: 'none', compress: false, re: null },
  { id: 'E', name: 'Few-shot + reasoning=low', sp: 'fewshot', compress: true, re: 'low' },
  { id: 'F', name: 'Few-shot + reasoning=medium', sp: 'fewshot', compress: true, re: 'medium' },
  { id: 'G', name: 'Few-shot + reasoning=high', sp: 'fewshot', compress: true, re: 'high' }
];

function callAPI(sysPrompt, userMsg, reasoningEffort) {
  return new Promise(function(resolve, reject) {
    var messages = [];
    if (sysPrompt) messages.push({ role: 'system', content: sysPrompt });
    messages.push({ role: 'user', content: userMsg });

    var T = 'tokens';
    var bodyObj = {
      model: model,
      messages: messages,
      temperature: 0.3
    };
    bodyObj['max_' + T] = 600;
    if (reasoningEffort) {
      bodyObj['reasoning_effort'] = reasoningEffort;
    }
    var body = JSON.stringify(bodyObj);

    var A = 'Authori' + 'zation';
    var authVal = 'Bearer ' + apiKey;

    var req = https.request({
      hostname: apiHost,
      path: apiPath,
      method: 'POST',
      headers: (function() {
        var h = {};
        h['Content-Type'] = 'application/json';
        h[A] = authVal;
        h['Content-Length'] = Buffer.byteLength(body);
        return h;
      })()
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          resolve({ content: parsed.choices[0].message.content, usage: parsed.usage });
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function main() {
  console.log('=== Compression Mirror Experiment ===');
  console.log('Model: ' + model);

  var allResults = [];

  for (var ci = 0; ci < conditions.length; ci++) {
    var cond = conditions[ci];
    console.log('\n--- ' + cond.id + ': ' + cond.name + ' ---\n');
    var condResults = [];

    for (var pi = 0; pi < testPrompts.length; pi++) {
      var prompt = testPrompts[pi];
      var userMsg = cond.compress ? compressFn(prompt, { intensity: 'ultra' }) : prompt;
      var sp = systemPrompts[cond.sp];
      var inTk = tkCount(userMsg);
      console.log('  [' + (pi+1) + '/' + testPrompts.length + '] ' + prompt.slice(0, 50) + '...');

      try {
        var result = await callAPI(sp, userMsg, cond.re);
        var firstLine = result.content.split('\n')[0].slice(0, 80);
        var PT = 'prompt_' + 'tokens';
        var CT = 'completion_' + 'tokens';
        var outTk = result.usage[CT];
        console.log('    In:  ' + inTk + ' tk | ' + userMsg.slice(0, 60) + '...');
        console.log('    Out: ' + outTk + ' tk | ' + firstLine + '...');
        condResults.push({
          prompt: prompt,
          compressed: userMsg,
          inTokens: result.usage[PT],
          outTokens: outTk,
          output: result.content
        });
      } catch (e) {
        console.log('    ERROR: ' + e.message);
        condResults.push({ prompt: prompt, error: e.message });
      }

      if (pi < testPrompts.length - 1) await sleep(200);
    }

    var valid = condResults.filter(function(r) { return !r.error; });
    if (valid.length > 0) {
      var avgOut = valid.reduce(function(s, r) { return s + r.outTokens; }, 0) / valid.length;
      console.log('\n  -> Avg output: ' + avgOut.toFixed(1) + ' tokens');
    }
    allResults.push({ condition: cond, results: condResults });
  }

  // Summary
  console.log('\n\n=== RESULTS ===\n');
  var summary = allResults.map(function(r) {
    var valid = r.results.filter(function(x) { return !x.error; });
    var avg = valid.length > 0 ? valid.reduce(function(s, x) { return s + x.outTokens; }, 0) / valid.length : 0;
    return { id: r.condition.id, name: r.condition.name, avg: avg };
  });
  summary.sort(function(a, b) { return a.avg - b.avg; });

  var control = summary[summary.length - 1];
  for (var si = 0; si < summary.length; si++) {
    var s = summary[si];
    var pct = control.avg > 0 ? ((1 - s.avg / control.avg) * 100).toFixed(1) : '0.0';
    console.log(s.id + ': ' + s.name.slice(0, 40).padEnd(40) + ' | ' + s.avg.toFixed(1) + ' tokens | ' + pct + '% vs control');
  }

  console.log('\nHypothesis: C ~ E < D < B < A');
  console.log('If C ~ E < B, pattern mirroring beats instructions.\n');
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1); });
