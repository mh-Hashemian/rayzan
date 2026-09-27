import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Model output is untrusted. Anything that is not an explicitly approved link
 * scheme renders as its text, never as a navigable anchor.
 */
const SAFE_HREF = /^(?:https?:|mailto:|#|\/)/i;

const components: Components = {
  // Only the props Markdown can legitimately produce are forwarded; react-markdown's
  // internal `node` prop and anything unexpected never reaches the DOM.
  a({ href, title, children }) {
    if (href === undefined || !SAFE_HREF.test(href)) {
      return <>{children}</>;
    }
    return (
      <a href={href} title={title ?? undefined} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="md-scroll-x">
        <table>{children}</table>
      </div>
    );
  },
};

// Raw HTML is never parsed (no rehype-raw), so script/embed/iframe cannot be
// produced at all. Images stay out until the attachment phase owns them.
const DISALLOWED = ['img', 'iframe', 'embed', 'object', 'form', 'input'] as const;

export function MarkdownBody(input: {
  readonly text: string;
  readonly tone?: 'primary' | 'secondary';
}) {
  return (
    <div className={`md-body md-tone-${input.tone ?? 'secondary'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        disallowedElements={[...DISALLOWED]}
        skipHtml
      >
        {input.text}
      </ReactMarkdown>
    </div>
  );
}
