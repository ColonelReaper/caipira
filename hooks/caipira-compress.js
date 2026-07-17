#!/usr/bin/env node
/**
 * caipira-compress.js — message_submit hook for CodeWhale
 *
 * Compresses user messages using caipira ULTRA rules before model sees them.
 * Combines caipira-shrink boundary protection with ultra-mode prose abbreviation.
 * Pure regex, zero API calls, runs locally in ~1ms.
 *
 * Stdin:  {"event":"message_submit","text":"...","session_id":"..."}
 * Stdout: {"text":"compressed text"}
 */

const LEXICON = { fillers: {}, articles: {}, hedges: {}, pleasantries: {}, abbreviations: {} };

// Intensity levels — loaded from ~/.claude/.caipira-active (default: full)
const fs = require('fs');
const path = require('path');
const os = require('os');

function getIntensity() {
  try {
    const flagPath = path.join(os.homedir(), '.claude', '.caipira-active');
    const mode = fs.readFileSync(flagPath, 'utf8').trim();
    if (['lite', 'full', 'ultra'].includes(mode)) return mode;
  } catch {}
  return 'full';
}

// ── BOUNDARY DETECTION ──

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const URL_RE = /https?:\/\/[^\s)]+/g;
const PATH_RE = /(?:[A-Za-z]:)?[\/\\][\w.\-\/\\]+/g;
const IDENTIFIER_RE = /\b[a-z_][a-z0-9_]{2,}\.[a-z_][a-z0-9_]*\b/gi;
const VERSION_RE = /\bv?\d+\.\d+(\.\d+)?(-[a-z0-9]+)?\b/g;
const SHELL_CMD_RE = /(?:^|\s)[\w.\-]+\s+(?:--?[\w-]+(?:=[\w.\-\/]+)?\s*)+/g;

function protectBoundaries(text) {
  const markers = [];
  let i = 0;
  const push = (match) => {
    const key = `__CW${i++}__`;
    markers.push({ key, original: match });
    return key;
  };
  return {
    protected: text
      .replace(CODE_BLOCK_RE, push)
      .replace(INLINE_CODE_RE, push)
      .replace(URL_RE, push)
      .replace(PATH_RE, push)
      .replace(IDENTIFIER_RE, push)
      .replace(VERSION_RE, push),
    markers
  };
}

function restoreBoundaries(text, markers) {
  let result = text;
  for (const { key, original } of markers) {
    result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
  }
  return result;
}

// ── PROSE COMPRESSION ──

function compressProse(text, intensity) {
  let result = text;

  // Remove filler words
  const fillers = [
    'basically', 'actually', 'literally', 'quite', 'rather', 'very',
    'kind of', 'sort of', 'pretty much', 'in order to',
    'it should be noted that', 'as a matter of fact', 'please note that',
    'i think that', 'i believe that', 'it seems that', 'it appears that'
  ];
  for (const f of fillers) {
    result = result.replace(new RegExp('\\b' + f.replace(/\s+/g, '\\s+') + '\\b', 'gi'), '');
  }

  // Drop articles
  if (intensity === 'full' || intensity === 'ultra') {
    result = result.replace(/\bthe\b/gi, '');
    result = result.replace(/\ba\b/gi, '');
    result = result.replace(/\ban\b/gi, '');
  }

  // Drop hedges
  const hedges = [
    'i would recommend', 'we should probably', 'it might be',
    'might want to', 'could potentially', 'may possibly',
    'i think', 'i believe', 'probably', 'maybe', 'perhaps'
  ];
  for (const h of hedges) {
    result = result.replace(new RegExp('\\b' + h.replace(/\s+/g, '\\s+') + '\\b', 'gi'), '');
  }

  // Drop pleasantries
  const pleasantries = ['please', 'thanks', 'thank you', 'sorry', 'sure', 'of course', 'no problem', 'happy to help'];
  for (const p of pleasantries) {
    result = result.replace(new RegExp('\\b' + p.replace(/\s+/g, '\\s+') + '\\b', 'gi'), '');
  }

  // Prose abbreviations (ultra only — never abbreviate code identifiers)
  if (intensity === 'ultra') {
    const abbrevs = {
      'database': 'DB', 'configuration': 'config', 'implementation': 'impl',
      'documentation': 'docs', 'repository': 'repo', 'application': 'app',
      'environment': 'env', 'dependency': 'dep', 'directory': 'dir',
      'parameter': 'param', 'arguments': 'args', 'function': 'fn',
      'variable': 'var', 'reference': 'ref', 'authentication': 'auth',
      'message': 'msg', 'transaction': 'tx', 'response': 'resp',
      'request': 'req', 'asynchronous': 'async', 'synchronous': 'sync',
      'because': 'b/c', 'with': 'w/', 'without': 'w/o',
      'should': 'shld', 'would': 'wld', 'could': 'cld',
      'between': 'btwn', 'through': 'thru', 'and': '&', 'before': 'b4'
    };
    for (const [long, short] of Object.entries(abbrevs)) {
      result = result.replace(new RegExp('\\b' + long + '\\b', 'gi'), short);
    }
  }

  // Clean up double spaces and leading/trailing whitespace
  result = result.replace(/\s{2,}/g, ' ').trim();

  return result;
}

// ── MAIN ──

function main() {
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString()); } catch {
      process.stdout.write(JSON.stringify({}));
      return;
    }

    const text = payload.text || '';
    if (!text.trim()) {
      process.stdout.write(JSON.stringify({ text }));
      return;
    }

    const intensity = getIntensity();
    const { protected: prot, markers } = protectBoundaries(text);
    let compressed = compressProse(prot, intensity);
    compressed = restoreBoundaries(compressed, markers);

    // Don't shrink if compression didn't help much
    if (compressed.length > text.length * 0.9) {
      process.stdout.write(JSON.stringify({ text }));
      return;
    }

    process.stdout.write(JSON.stringify({ text: compressed }));
  });
}

main();
