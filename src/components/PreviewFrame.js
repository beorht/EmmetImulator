/**
 * Изолированный предпросмотр HTML.
 * iframe с пустым sandbox: без скриптов, без доступа к родительскому окну,
 * без отправки форм. CSP внутри документа запрещает внешние загрузки.
 */

const BLOCKED_TAGS = 'script, iframe, frame, object, embed, link, meta, base, style, template';

const PREVIEW_STYLES = `
  :root { color-scheme: light; }
  html, body { margin: 0; }
  body {
    padding: 12px 14px;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #3D3A36;
    background: #FFFDF9;
  }
  [data-t] { outline: 1px dashed #D9CBB5; outline-offset: 2px; }
  [data-t]:empty::before {
    content: "<" attr(data-t) ">";
    font: 11px/1.4 ui-monospace, monospace;
    color: #A8977E;
  }
  h1, h2, h3, p, ul, ol { margin: 6px 0; }
  a { color: #8A5F35; }
  button, input { font: inherit; }
  img { min-width: 40px; min-height: 28px; background: #F3ECE1; }
`;

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function sanitize(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;

  root.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  root.querySelectorAll('*').forEach((element) => {
    for (const { name, value } of [...element.attributes]) {
      if (name.startsWith('on') || /^\s*javascript:/i.test(value)) element.removeAttribute(name);
    }
    // Подпись тега для пустых элементов — чтобы была видна сама структура.
    element.setAttribute('data-t', element.tagName.toLowerCase());
  });

  const container = document.createElement('div');
  container.append(root);
  return container.innerHTML;
}

export class PreviewFrame {
  constructor({ title }) {
    this.element = document.createElement('iframe');
    this.element.className = 'preview-frame';
    this.element.title = title;
    this.element.setAttribute('sandbox', '');
    this.element.setAttribute('referrerpolicy', 'no-referrer');
    this.render('');
  }

  render(html) {
    this.element.srcdoc = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${PREVIEW_STYLES}</style></head><body>${sanitize(html)}</body></html>`;
  }
}
