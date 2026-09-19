'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { safeUrl } from '@/lib/chat-format';

// Only these elements can ever render. Raw HTML in the source is never
// interpreted (react-markdown ignores it), headings/images/tables are unwrapped
// to plain text, and only http(s)/mailto links survive.
const ALLOWED = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'del', 'a', 'br', 'code'];

type Tone = 'card' | 'bubble-own' | 'bubble';

function components(tone: Tone): Components {
  const link =
    tone === 'bubble-own'
      ? 'font-semibold underline decoration-[#00232A]/40 underline-offset-2'
      : 'font-semibold text-brand underline decoration-brand/40 underline-offset-2';
  const marker = tone === 'bubble-own' ? 'marker:text-[#00232A]' : 'marker:text-brand';
  return {
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className={`my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0 ${marker}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0 ${marker}`}>{children}</ol>,
    li: ({ children }) => <li className="pl-0.5 [&>ul]:my-1 [&>ol]:my-1">{children}</li>,
    strong: ({ children }) => <strong className="font-bold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children }) => <code className="rounded bg-black/25 px-1 py-0.5 text-[0.9em]">{children}</code>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className={link}>
        {children}
      </a>
    ),
  };
}

/** Renders stored chat text (Markdown subset). Old plain-text messages render
 * unchanged: single line breaks are kept and nothing is escaped away. */
export function ChatMarkdown({ text, tone = 'card' }: { text: string; tone?: Tone }) {
  return (
    <div className="break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={safeUrl}
        components={components(tone)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
