// {{field}} placeholder substitution against a JSON payload, using a safe
// lodash-style property-path `get` — never eval() / new Function() / vm.
// This is intentionally "dumb" string/object templating with no code
// execution path, by design (see the action-type spec: no arbitrary code
// execution is ever allowed here).
const get = require('lodash.get');

const FULL_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_$.[\]]+)\s*\}\}$/;
const INLINE_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_$.[\]]+)\s*\}\}/g;

function resolveString(str, payload) {
  const fullMatch = str.match(FULL_PLACEHOLDER_RE);
  if (fullMatch) {
    // The whole string is a single placeholder — preserve the resolved
    // value's original type (number, object, boolean, ...) rather than
    // stringifying it.
    return get(payload, fullMatch[1]);
  }
  return str.replace(INLINE_PLACEHOLDER_RE, (_match, path) => {
    const value = get(payload, path);
    if (value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/**
 * Recursively resolves {{field}} placeholders anywhere inside a string,
 * array, or plain object against `payload`, using safe property-path
 * lookups only.
 */
function renderTemplate(node, payload) {
  if (typeof node === 'string') return resolveString(node, payload);
  if (Array.isArray(node)) return node.map((item) => renderTemplate(item, payload));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = renderTemplate(value, payload);
    }
    return out;
  }
  return node;
}

module.exports = { renderTemplate };
