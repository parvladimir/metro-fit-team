'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { safeUrl } from '@/lib/chat-format';
import { splitByMentions, type MessageMention } from '@/lib/mentions';

// Only these elements can ever render. Raw HTML in the source is never
// interpreted (react-markdown ignores it), headings/images/tables are unwrapped
// to plain text, and only http(s)/mailto links survive. "span" only ever comes
// from the mention plugin below — never from message text.
const ALLOWED = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'del', 'a', 'br', 'code', 'span'];

type Tone = 'card' | 'bubble-own' | 'bubble';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

/** remark plugin: turns "@Name" in plain text nodes into mention spans — but only
 * for mentions resolved in the database (never for arbitrary @words or e-mails). */
function remarkMentions(mentions: MessageMention[]) {
  return () => (tree: MdNode) => {
    if (mentions.length === 0) return;
    const visit = (node: MdNode) => {
      if (!node.children || node.type === 'link' || node.type === 'inlineCode') return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string') {
          for (const part of splitByMentions(child.value, mentions)) {
            if (part.type === 'text') next.push({ type: 'text', value: part.value });
            else
              next.push({
                type: 'mention',
                data: { hName: 'span', hProperties: { 'data-mention': part.userId } },
                children: [{ type: 'text', value: part.value }],
              });
          }
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

function components(tone: Tone, currentUserId: string | null): Components {
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
    span: ({ children, ...props }) => {
      const userId = (props as Record<string, unknown>)['data-mention'] as string | undefined;
      if (!userId) return <span>{children}</span>;
      const me = userId === currentUserId;
      const onCyan = tone === 'bubble-own';
      return (
        <span
          data-mention={userId}
          className={[
            'rounded-md px-1 py-px font-semibold [box-decoration-break:clone]',
            onCyan
              ? 'bg-[#00232A]/15 text-[#00232A]'
              : me
                ? 'bg-brand/25 text-brand ring-1 ring-brand/60'
                : 'bg-brand/12 text-brand',
          ].join(' ')}
        >
          {children}
        </span>
      );
    },
  };
}

/** Renders stored chat text (Markdown subset). Old plain-text messages render
 * unchanged: single line breaks are kept and nothing is escaped away. */
export function ChatMarkdown({
  text,
  tone = 'card',
  mentions = [],
  currentUserId = null,
}: {
  text: string;
  tone?: Tone;
  mentions?: MessageMention[];
  currentUserId?: string | null;
}) {
  return (
    <div className="break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions(mentions)]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={safeUrl}
        components={components(tone, currentUserId)}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
