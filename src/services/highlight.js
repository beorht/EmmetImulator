/** Лёгкая подсветка для демонстрации: HTML-разметка и Emmet-сокращения. */

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

export function highlightAbbreviation(source) {
  let out = '';
  for (const token of source.matchAll(/\{[^}]*\}?|\[[^\]]*\]?|[>+^*()]|[.#][\w$-]*|\$+|\d+|[^>+^*().#{[$\d]+/g)) {
    const text = token[0];
    const kind =
      text[0] === '{' ? 'string'
        : text[0] === '[' ? 'attr'
          : '>+^*()'.includes(text) ? 'operator'
            : text[0] === '.' || text[0] === '#' ? 'selector'
              : /^[$\d]/.test(text) ? 'number'
                : 'tag';
    out += span(kind, text);
  }
  return out;
}
