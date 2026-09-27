import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MarkdownBody } from '../src/components/markdown/MarkdownBody.js';
import { ResponseViewer } from '../src/components/markdown/ResponseViewer.js';

const FIXTURE = `# Decision review

**Bold** and _italic_ survive, and so does \`inline code\`.

- first item
- second item

1. numbered one
2. numbered two

> quote the risk before acting

\`\`\`ts
const x = 1;
\`\`\`

| Watcher | Position |
| --- | --- |
| DeepSeek | favour |
| Grok | oppose |

---

[open docs](https://example.com/a)
`;

function render(text: string): string {
  return renderToStaticMarkup(<MarkdownBody text={text} tone="primary" />);
}

describe('MarkdownBody rendering', () => {
  it('renders the supported Markdown surface as real elements', () => {
    const html = render(FIXTURE);
    assert.match(html, /<h1[^>]*>Decision review<\/h1>/);
    assert.match(html, /<strong>Bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<code>inline code<\/code>/);
    assert.match(html, /<ul>\s*<li>first item<\/li>\s*<li>second item<\/li>\s*<\/ul>/);
    assert.match(html, /<ol>\s*<li>numbered one<\/li>\s*<li>numbered two<\/li>\s*<\/ol>/);
    assert.match(
      html,
      /<blockquote>\s*<p>quote the risk before acting<\/p>\s*<\/blockquote>/,
    );
    assert.match(html, /<pre><code class="language-ts">const x = 1;\n?<\/code><\/pre>/);
    assert.match(html, /<th>Watcher<\/th>/);
    assert.match(html, /<td>oppose<\/td>/);
    assert.match(html, /<hr\s*\/>/);
  });

  it('keeps code whitespace and scrolls wide tables', () => {
    const html = render(FIXTURE);
    assert.match(html, /<pre><code class="language-ts">const x = 1;/);
    assert.ok(
      /<div class="md-scroll-x"><table>/.test(html),
      'tables need a real table inside a scroll wrapper',
    );
  });

  it('opens external links safely', () => {
    const html = render(FIXTURE);
    assert.match(
      html,
      /<a[^>]*href="https:\/\/example\.com\/a"[^>]*target="_blank"[^>]*rel="noreferrer noopener"/,
    );
    assert.ok(!html.includes('[object Object]'), 'no internal node props leak');
  });
});

describe('MarkdownBody sanitization', () => {
  it('never emits script tags from model output', () => {
    const html = render('<script>alert(1)</script>\n\n<script src="x"></script>');
    assert.ok(!html.toLowerCase().includes('<script'), html);
    assert.ok(!html.includes('alert(1)'), html);
  });

  it('never emits event handlers', () => {
    const html = render(
      '<img src=x onerror=alert(1)>\n\n<div onclick="steal()">click me</div>',
    );
    assert.ok(!html.toLowerCase().includes('<img'), html);
    assert.ok(!html.includes('onerror'), html);
    assert.ok(!html.includes('onclick'), html);
    assert.ok(!html.includes('steal()'), html);
  });

  it('refuses unsafe link schemes', () => {
    const html = render(
      '[x](javascript:alert(1))\n\n[y](data:text/html;base64,PHNjcmlwdD4=)\n\n[z](vbscript:msgbox)',
    );
    assert.ok(!html.includes('javascript:'), html);
    assert.ok(!html.includes('data:text/html'), html);
    assert.ok(!html.includes('vbscript:'), html);
    assert.ok(!/<a /i.test(html), html);
  });

  it('drops embed, object, iframe and form elements', () => {
    const html = render(
      '<iframe src="https://evil.example"></iframe>\n\n<embed src="x">\n\n<object data="y"></object>\n\n<form action="https://evil.example"><input name="t"></form>',
    );
    for (const tag of ['iframe', 'embed', 'object', 'form', 'input']) {
      assert.ok(!html.includes(`<${tag}`), `${tag} leaked: ${html}`);
    }
  });

  it('renders raw HTML inside a code fence as text only', () => {
    const html = render('```\n<script>alert(1)</script>\n```');
    assert.ok(!html.includes('<script>'), html);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

describe('ResponseViewer', () => {
  it('defaults to the rendered view', () => {
    const html = renderToStaticMarkup(
      <ResponseViewer text={'# Title\n\n- one'} tone="primary" />,
    );
    assert.match(html, /<h1[^>]*>Title<\/h1>/);
    assert.ok(!html.includes('<pre'), 'raw pre must be hidden by default');
  });

  it('offers both modes with Rendered active by default', () => {
    const html = renderToStaticMarkup(
      <ResponseViewer text={'# Title\n\nconst exact = "text";'} />,
    );
    assert.match(html, /aria-pressed="true"[^>]*>Rendered</, html);
    assert.match(html, /aria-pressed="false"[^>]*>Raw</, html);
    assert.ok(html.includes('md-body'), html);
  });

  it('tolerates a missing response', () => {
    const html = renderToStaticMarkup(<ResponseViewer text={undefined} />);
    assert.match(html, /class="md-body/, html);
  });
});
