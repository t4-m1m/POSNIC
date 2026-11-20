const fs = require('fs');
const file = 'tests/unit/repositories/item.repository.test.js';
const s = fs.readFileSync(file, 'utf8');

let stack = [];
let i = 0, line = 1, state = 'code';
const pairs = { ')': '(', '}': '{', ']': '[' };

while (i < s.length) {
  const c = s[i], n = s[i + 1];

  if (c === '\n') line++;

  if (state === 'lineComment') {
    if (c === '\n') state = 'code';
    i++; continue;
  }
  if (state === 'blockComment') {
    if (c === '*' && n === '/') { state = 'code'; i += 2; continue; }
    i++; continue;
  }
  if (state === 'single' || state === 'double' || state === 'template') {
    if (c === '\\') { if (n === '\n') line++; i += 2; continue; }
    if ((state === 'single' && c === "'") ||
        (state === 'double' && c === '"') ||
        (state === 'template' && c === '`')) state = 'code';
    i++; continue;
  }

  if (c === '/' && n === '/') { state = 'lineComment'; i += 2; continue; }
  if (c === '/' && n === '*') { state = 'blockComment'; i += 2; continue; }
  if (c === "'") { state = 'single'; i++; continue; }
  if (c === '"') { state = 'double'; i++; continue; }
  if (c === '`') { state = 'template'; i++; continue; }

  if ('({['.includes(c)) stack.push({ c, line });
  else if (')}]'.includes(c)) {
    const top = stack.pop();
    if (!top || top.c !== pairs[c]) {
      console.log(`Mismatched ${c} at line ${line}; opening delimiter:`, top);
      process.exit(1);
    }
  }
  i++;
}

console.log('Remaining opening delimiters:', stack);
console.log('Final parser state:', state);
