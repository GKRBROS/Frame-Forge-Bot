import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'inherit',
});

interface MermaidProps {
  chart: string;
}

export const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && chart) {
      mermaid.contentLoaded();
      // Use a unique ID for each diagram to avoid conflicts
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      
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
    }
  }, [chart]);

  return (
    <div className="mermaid-container overflow-x-auto my-4 rounded-xl bg-black/40 p-4 border border-white/10 flex justify-center" ref={ref} />
  );
};
