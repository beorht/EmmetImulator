/** Лёгкая подсветка HTML-разметки для образца. */

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

const span = (cls, text) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

export function highlightHtml(source) {
  let out = '';
  let last = 0;
  for (const match of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g)) {
    out += span('text', source.slice(last, match.index));
    const [, slash, name, attrs, selfClose] = match;
    out += span('punct', `<${slash}`) + span('tag', name);
    for (const part of attrs.matchAll(/(\s+)|([^\s=]+)(?:(=)("[^"]*"|'[^']*'|[^\s"']+))?/g)) {
      const [, space, attr, eq, value] = part;
      if (space) out += escapeHtml(space);
      else out += span('attr', attr) + (eq ? span('punct', eq) + span('string', value) : '');
    }
    out += span('punct', `${selfClose}>`);
    last = match.index + match[0].length;
  }
  return out + span('text', source.slice(last));
}
