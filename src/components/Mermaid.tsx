import React, { useEffect, useRef } from 'react';

interface MermaidProps {
  chart: string;
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && chart) {
      // Dynamically load mermaid library only on the client side
      import('mermaid')
        .then((m) => {
          const mermaid = m.default;
          mermaid.initialize({
            startOnLoad: true,
            theme: 'dark',
            securityLevel: 'loose',
            fontFamily: 'inherit',
          });

          mermaid.contentLoaded();
          const id = `mermaid-${Math.random().toString(36).substring(2, 11)}`;

          try {
            mermaid.render(id, chart).then(({ svg }) => {
              if (ref.current) {
                ref.current.innerHTML = svg;
              }
            });
          } catch (error) {
            console.error('Mermaid render error:', error);
            if (ref.current) {
              ref.current.innerHTML = '<p class="text-destructive text-xs">Failed to render diagram</p>';
            }
          }
        })
        .catch((err) => {
          console.error('Failed to import mermaid library:', err);
        });
    }
  }, [chart]);

  return (
    <div className="mermaid-container overflow-x-auto my-4 rounded-xl bg-black/40 p-4 border border-white/10 flex justify-center" ref={ref} />
  );
};
