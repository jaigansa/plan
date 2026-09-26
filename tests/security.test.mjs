/**
 * XSS guard rails.
 *
 * The app builds DOM with template literals, which is fast to write and easy to
 * get wrong: `${card.title}` in an innerHTML string is a stored-XSS hole, and it
 * can arrive from an imported JSON file or a shared cloud card. escapeHtml only
 * helps if it is actually used, so this test enforces the rule mechanically
 * instead of trusting review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsDir = join(root, 'js');

const files = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const source = (f) => readFileSync(join(jsDir, f), 'utf8');

/** Free-text, user-authored fields. These are the stored-XSS surface. */
const FREE_TEXT_FIELDS = ['title', 'description', 'text', 'comment', 'notes', 'body'];

/** Expressions that are safe to interpolate even though they mention a field. */
const SAFE_EXPRESSION = [
  'escapeHtml', 'sanitizeUrl', 'encodeURIComponent',
  '.length', '.map(', '.filter(', '.join(', '.slice(', '.includes(',
  '.toUpperCase(', '.toLowerCase(', '.trim(', '.getDay(',
  'PRIORITIES[', 'DAY_INFO', 'getTodayCode', 'Core.',
  'completed ?', '.completed', '.shared', 'priorityLabel', 'intervalMins'
];

/**
 * Extract the template literals that are assigned to innerHTML /
 * insertAdjacentHTML. Only markup built this way can execute injected HTML, so
 * scanning exactly these blocks avoids false positives from confirm() dialogs
 * and CSV export, which handle the same fields safely.
 */
function htmlTemplateBlocks(text) {
  const blocks = [];
  const trigger = /\.innerHTML\s*=\s*`|insertAdjacentHTML\(\s*['"][^'"]*['"]\s*,\s*`/g;
  let m;

  while ((m = trigger.exec(text)) !== null) {
    const start = text.indexOf('`', m.index);
    if (start === -1) continue;

    let i = start + 1;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '$' && text[i + 1] === '{') { depth++; i += 2; continue; }
      if (ch === '}' && depth > 0) { depth--; i++; continue; }
      if (ch === '`' && depth === 0) break;
      i++;
    }
    const body = text.slice(start + 1, i);
    if (body.indexOf('<') !== -1) {
      blocks.push({ body, line: text.slice(0, start).split('\n').length });
    }
    trigger.lastIndex = i;
  }
  return blocks;
}

test('free-text user data is escaped wherever it is interpolated into HTML', () => {
  const offenders = [];

  files.forEach((file) => {
    const text = source(file);
    htmlTemplateBlocks(text).forEach((block) => {
      // Only look inside ${...}, not at literal markup.
      (block.body.match(/\$\{[^{}]*\}/g) || []).forEach((expr) => {
        const mentionsUserText = FREE_TEXT_FIELDS.some(
          (f) => new RegExp('\\.' + f + '\\b').test(expr)
        );
        if (!mentionsUserText) return;
        if (SAFE_EXPRESSION.some((safe) => expr.indexOf(safe) !== -1)) return;
        offenders.push(`${file}:${block.line}  ${expr}`);
      });
    });
  });

  assert.deepEqual(offenders, [],
    'these interpolations put user text into HTML unescaped:\n' + offenders.join('\n'));
});

test('the HTML scanner actually finds the known markup blocks', () => {
  // Guard against the scanner silently matching nothing, which would make the
  // test above pass for the wrong reason.
  const appBlocks = htmlTemplateBlocks(source('app.js'));
  assert.ok(appBlocks.length >= 4, 'expected several innerHTML blocks in app.js');
  const modalBlocks = htmlTemplateBlocks(source('modal.js'));
  assert.ok(modalBlocks.length >= 2, 'expected innerHTML blocks in modal.js');
  // and it must ignore non-HTML template literals
  const csvBlockFound = appBlocks.some((b) => b.body.indexOf('rows.push') !== -1);
  assert.equal(csvBlockFound, false, 'CSV export is not an HTML sink');
});

test('the checklist id attribute is escaped (regression: stored XSS via item.id)', () => {
  const modal = source('modal.js');

  // item.id must never reach the id/for attributes directly.
  assert.equal(/\$\{\s*item\.id\s*\}/.test(modal), false,
    'item.id is interpolated raw somewhere in modal.js');

  // It must be escaped into a local first, and that local used in both spots.
  assert.match(modal, /escapeHtml\(String\(item\.id\)\)/,
    'item.id should be escaped before being placed in an attribute');

  const uses = (modal.match(/\$\{safeId\}/g) || []).length;
  assert.ok(uses >= 2, 'both the id and the for attribute must use the escaped value');
});

test('escapeHtml neutralises every dangerous character', async () => {
  const { escapeHtml } = await import('../js/utils.js');

  assert.equal(escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('a"b'), 'a&quot;b');
  assert.equal(escapeHtml("a'b"), 'a&#39;b');
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0', '0 is falsy but must not vanish');
});

test('escapeHtml output cannot break out of a quoted attribute', async () => {
  const { escapeHtml } = await import('../js/utils.js');
  const payload = 'x" onerror="alert(1)';
  const attr = 'id="chk-' + escapeHtml(payload) + '"';
  assert.equal(attr.indexOf('" on'), -1, 'raw quote must not survive into the attribute');
  assert.ok(attr.includes('&quot;'));
});

test('sanitizeUrl only allows http(s) and data images', async () => {
  const { sanitizeUrl } = await import('../js/utils.js');

  assert.equal(sanitizeUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(sanitizeUrl('http://example.com/a.png'), 'http://example.com/a.png');
  assert.equal(sanitizeUrl('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('  javascript:alert(1)  '), '');
  assert.equal(sanitizeUrl('data:text/html,<script>'), '', 'only data:image is allowed');
  assert.equal(sanitizeUrl(''), '');
});

test('every external script tag is pinned and SRI-protected', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const tags = html.match(/<script[^>]*src="https?:[^"]*"[^>]*>/g) || [];
  assert.ok(tags.length > 0, 'expected the CDN script tags to still be present');

  tags.forEach((tag) => {
    assert.match(tag, /integrity="sha(256|384|512)-/, 'missing SRI: ' + tag);
    assert.match(tag, /crossorigin="anonymous"/, 'SRI needs crossorigin: ' + tag);
    assert.doesNotMatch(tag, /@latest|\/npm\/[^"@]+"|@2"|@\^/, 'version must be pinned: ' + tag);
  });
});

test('the page loads the classic scripts the service worker also needs', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  ['js/reminder-core.js', 'js/plan-store.js'].forEach((f) => {
    assert.ok(html.includes(f), f + ' must be loaded by index.html');
  });

  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(sw, /importScripts\([^)]*reminder-core\.js/);
  assert.match(sw, /importScripts\([^)]*plan-store\.js/);
  assert.match(sw, /addEventListener\('periodicsync'/, 'worker must handle periodic background sync');
});

test('the service worker stamps reminders so the page does not repeat them', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(sw, /computeDueReminders/, 'worker must use the shared rules');
  assert.match(sw, /markNotified/, 'worker must record what it sent');
  assert.ok(!/computeDueReminders\s*\(/.test(sw.replace(/core\.computeDueReminders/g, '')),
    'worker must not reimplement the rules');
});
