// Semantic-ish chunker: splits text into ~target-size chunks on paragraph/sentence boundaries with overlap.
const TARGET = 900;
const OVERLAP = 120;

export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];

  // Split into paragraphs first
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim().length > 0) chunks.push(buf.trim());
    buf = "";
  };

  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length <= TARGET) {
      buf = buf ? buf + "\n\n" + p : p;
    } else if (p.length > TARGET) {
      flush();
      // Split long paragraph by sentences
      const sentences = p.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if ((buf + " " + s).length <= TARGET) {
          buf = buf ? buf + " " + s : s;
        } else {
          flush();
          if (s.length > TARGET) {
            // Hard split
            for (let i = 0; i < s.length; i += TARGET - OVERLAP) {
              chunks.push(s.slice(i, i + TARGET));
            }
          } else {
            buf = s;
          }
        }
      }
    } else {
      flush();
      buf = p;
    }
  }
  flush();

  // Add overlap
  if (chunks.length > 1) {
    return chunks.map((c, i) => {
      if (i === 0) return c;
      const prev = chunks[i - 1];
      const tail = prev.slice(Math.max(0, prev.length - OVERLAP));
      return tail + " … " + c;
    });
  }
  return chunks;
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
