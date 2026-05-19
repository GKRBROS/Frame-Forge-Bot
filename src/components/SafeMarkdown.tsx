import React, { useEffect, useState } from "react";
import { Mermaid } from "./Mermaid";

interface SafeMarkdownProps {
  content: string;
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ content }) => {
  const [modules, setModules] = useState<{
    ReactMarkdown: any;
    remarkGfm: any;
  } | null>(null);

  useEffect(() => {
    Promise.all([
      import("react-markdown"),
      import("remark-gfm")
    ])
      .then(([markdownMod, gfmMod]) => {
        setModules({
          ReactMarkdown: markdownMod.default,
          remarkGfm: gfmMod.default,
        });
      })
      .catch((err) => {
        console.error("Failed to dynamically load markdown dependencies:", err);
      });
  }, []);

  if (!modules) {
    return (
      <div className="leading-relaxed text-[15px] space-y-3 whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  const { ReactMarkdown, remarkGfm } = modules;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-xl font-semibold mt-2 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-semibold mt-2 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ node, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || '');
          const isMermaid = match && match[1] === 'mermaid';
          if (isMermaid) {
            return <Mermaid chart={String(children).replace(/\n$/, '')} />;
          }
          return <code className="rounded bg-black/20 px-1 py-0.5 text-[0.92em]" {...props}>{children}</code>;
        },
        blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">{children}</blockquote>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
