import React, { useEffect, useState } from "react";

interface MarkdownProps {
  content: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content }) => {
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
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm break-words leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  const { ReactMarkdown, remarkGfm } = modules;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm dark:prose-invert max-w-none text-sm break-words leading-relaxed"
    >
      {content}
    </ReactMarkdown>
  );
};
