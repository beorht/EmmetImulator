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

  // Текст в {…} Emmet вставляет как есть — так в сокращение можно спрятать готовый HTML.
  if (/\{[^}]*[<>]/.test(abbreviation)) {
    throw new EmmetError('В тексте {…} нельзя писать HTML-теги — получите их самим сокращением.');
  }

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

/**
 * Ищет сокращение слева от позиции курсора в строке.
 * wholeLineOnly — только если вся строка до курсора и есть сокращение (для заданий,
 * где HTML пишут руками: Tab в середине разметки должен ставить отступ, а не разворачивать).
 */
export function extractAbbreviation(line, position, { wholeLineOnly = false } = {}) {
  const whole = wholeLineAbbreviation(line, position);
  if (whole || wholeLineOnly) return whole;
  const found = extract(line, position, { type: 'markup', lookAhead: false });
  return found ? { abbreviation: found.abbreviation, start: found.start, end: found.end } : null;
}

/**
 * Если в строке до курсора нет ничего, кроме сокращения, берём его целиком.
 * Экстрактор Emmet сканирует строку с конца и на длинных цепочках вида
 * a[href=#]{…}+ul>li*5>a[href=#p$]{$}^^a обрывается посередине — тогда Tab развернул бы
 * только хвост. Пробелы вне {…}, […] и кавычек означают, что в строке не одно сокращение.
 */
function wholeLineAbbreviation(line, position) {
  const start = line.length - line.trimStart().length;
  const candidate = line.slice(start, position);
  if (!candidate || candidate.includes('<') || hasLooseSpace(candidate)) return null;
  try {
    expand(candidate);
  } catch {
    return null;
  }
  return { abbreviation: candidate, start, end: position };
}

function hasLooseSpace(text) {
  let closer = null;
  for (const char of text) {
    if (closer) {
      if (char === closer) closer = null;
    } else if (char === '{') closer = '}';
    else if (char === '[') closer = ']';
    else if (char === '"' || char === "'") closer = char;
    else if (/\s/.test(char)) return true;
  }
  return false;
}

function translateError(error) {
  const match = /at (\d+)/.exec(error.message ?? '');
  const where = match ? ` (позиция ${Number(match[1]) + 1})` : '';
  if (/Unexpected character/i.test(error.message)) return `В сокращении неожиданный символ${where}.`;
  if (/Unexpected end/i.test(error.message)) return 'Сокращение оборвалось — проверьте скобки.';
  return `Emmet не смог разобрать сокращение${where}.`;
}
