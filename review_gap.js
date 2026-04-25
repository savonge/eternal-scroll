#!/usr/bin/env node
// review_gap.js
// Reads the GAP array from index.html, sends each book to Claude for fact-checking,
// applies only high-confidence factual corrections, writes patched index.html.
// Usage: ANTHROPIC_API_KEY=sk-ant-... node review_gap.js

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, 'index.html');
const MODEL     = 'claude-sonnet-4-6';
const API_URL   = 'https://api.anthropic.com/v1/messages';
const API_KEY   = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set.');
  console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... node review_gap.js');
  process.exit(1);
}

const SYSTEM_PROMPT = `You are a fact-checker specializing in Jewish history, Israeli history, and the history of the Jewish people across all periods from antiquity to the present.

Your task is to read a passage of literary text and identify ONLY claims that are demonstrably, specifically, and certainly wrong.

Flag ONLY:
- A specific number that is verifiably incorrect (wrong death toll, wrong count, wrong year expressed as a number)
- A specific date or time reference that is factually wrong (e.g. "seventh month" when the event occurred in the tenth month)
- A named person assigned an action, role, or quote that history directly contradicts
- A sequence of events that is clearly and certainly inverted or misplaced

Do NOT flag:
- Literary compression, omission, or simplification
- Poetic or metaphorical language
- Theological or interpretive claims
- Anything where you are less than 95% certain it is wrong
- Things that are incomplete but not incorrect
- Stylistic choices

For each flag, return a JSON object with exactly these fields:
- "quote": the exact phrase from the text that contains the error (keep it short, 5-15 words)
- "error": one sentence explaining what is factually wrong
- "fix": the corrected phrase in the same literary register and style as the original

Return a JSON array. If you find nothing that meets this strict standard, return an empty array: []
Return ONLY the JSON array, no other text.`;

async function callAPI(bookTitle, verses) {
  const text = verses.flat().join('\n');
  const body = {
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Book: ${bookTitle}\n\n${text}`
    }]
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.content.find(b => b.type === 'text')?.text || '[]';

  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON array from response if model added any preamble
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  }
}

async function main() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  // Extract the GAP array as a JSON string
  const gapMatch = html.match(/const GAP\s*=\s*(\[[\s\S]*?\]);(?:\s*\n)/);
  if (!gapMatch) {
    // Try single-line match
    const inline = html.match(/const GAP\s{0,4}=\s*(\[.+?\]);/);
    if (!inline) { console.error('Could not find GAP array'); process.exit(1); }
  }

  // Parse GAP by evaluating it safely
  let GAP;
  try {
    const gapLine = html.match(/^const GAP\s.*$/m)[0];
    eval(gapLine.replace('const GAP', 'GAP = ').replace(/^GAP\s{0,4}=\s{0,4}=/, 'GAP ='));
  } catch(e) {
    // fallback
    try {
      const gapLine = html.match(/^const GAP\s.*$/m)[0];
      GAP = eval('(' + gapLine.replace(/^const GAP\s*=\s*/, '').replace(/;$/, '') + ')');
    } catch(e2) {
      console.error('Could not parse GAP array:', e2.message);
      process.exit(1);
    }
  }

  console.log(`Reviewing ${GAP.length} books...\n`);

  let patchedHtml = html;
  let totalFlags  = 0;
  let totalFixed  = 0;

  for (const book of GAP) {
    process.stdout.write(`  ${book.title}...`);

    let flags;
    try {
      flags = await callAPI(book.title, book.chapters);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
      continue;
    }

    if (!flags || flags.length === 0) {
      console.log(' clean');
      continue;
    }

    totalFlags += flags.length;
    console.log(` ${flags.length} flag(s)`);

    for (const flag of flags) {
      console.log(`    ⚠ "${flag.quote}"`);
      console.log(`      Error: ${flag.error}`);
      console.log(`      Fix:   "${flag.fix}"`);

      // Apply the fix: find the exact quote in the HTML and replace with fix
      if (patchedHtml.includes(flag.quote)) {
        patchedHtml = patchedHtml.replace(flag.quote, flag.fix);
        console.log(`      ✅ Applied`);
        totalFixed++;
      } else {
        // Quote might have JSON escaping — try unescaped version
        const escaped = JSON.stringify(flag.quote).slice(1, -1);
        const fixEscaped = JSON.stringify(flag.fix).slice(1, -1);
        if (patchedHtml.includes(escaped)) {
          patchedHtml = patchedHtml.replace(escaped, fixEscaped);
          console.log(`      ✅ Applied (escaped)`);
          totalFixed++;
        } else {
          console.log(`      ⚠ Quote not found in HTML — skipped`);
        }
      }
    }
  }

  if (totalFixed > 0) {
    fs.writeFileSync(HTML_PATH, patchedHtml);
    console.log(`\nDone. ${totalFlags} flag(s), ${totalFixed} fix(es) applied. index.html updated.`);
  } else {
    console.log(`\nDone. ${totalFlags} flag(s) found, none applied. index.html unchanged.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
