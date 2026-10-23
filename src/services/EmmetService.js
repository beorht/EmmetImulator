import expand, { extract } from 'emmet';

export const INDENT = '  ';

// Маркер позиции поля (tabstop) — по нему ставим курсор после развёртывания.
const FIELD = '\u0001';

export class EmmetError extends Error {}

/**
 * Разворачивает Emmet-сокращение в HTML.
 * withCursor — вернуть позицию первого пустого поля, как делает Emmet в редакторе.
 */
export function expandAbbreviation(abbreviation, { baseIndent = '', withCursor = false } = {}) {
  const options = { 'output.indent': INDENT, 'output.baseIndent': baseIndent };
  if (withCursor) options['output.field'] = (_index, placeholder) => FIELD + placeholder;

  let output;
  try {
    output = expand(abbreviation, { options });
  } catch (error) {
    throw new EmmetError(translateError(error));
  }

  const firstField = output.indexOf(FIELD);
  const html = output.split(FIELD).join('');
  return { html, cursor: firstField === -1 ? html.length : firstField };
}

/** Ищет сокращение слева от позиции курсора в строке. */
export function extractAbbreviation(line, position) {
  const found = extract(line, position, { type: 'markup', lookAhead: false });
  return found ? { abbreviation: found.abbreviation, start: found.start, end: found.end } : null;
}

function translateError(error) {
  const match = /at (\d+)/.exec(error.message ?? '');
  const where = match ? ` (позиция ${Number(match[1]) + 1})` : '';
  if (/Unexpected character/i.test(error.message)) return `В сокращении неожиданный символ${where}.`;
  if (/Unexpected end/i.test(error.message)) return 'Сокращение оборвалось — проверьте скобки.';
  return `Emmet не смог разобрать сокращение${where}.`;
}
