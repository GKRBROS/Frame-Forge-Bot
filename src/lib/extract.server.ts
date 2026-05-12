// Lightweight text extractors that work in the Worker runtime.
// Supported: text/plain, text/markdown, text/csv, application/json.
// PDF/DOCX/PPTX/XLSX/images are not parsed in v1 — users can paste text instead.

export const SUPPORTED_TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/html",
  "text/x-markdown",
]);

export function isTextMime(mime?: string | null): boolean {
  if (!mime) return false;
  if (SUPPORTED_TEXT_MIME.has(mime)) return true;
  return mime.startsWith("text/");
}

export async function extractTextFromBlob(blob: Blob, mime: string): Promise<string> {
  if (!isTextMime(mime)) {
    throw new Error(
      `Unsupported file type "${mime}". Supported: .txt .md .csv .json .xml .html — or paste text directly.`,
    );
  }
  const raw = await blob.text();
  if (mime === "text/csv") {
    // Light CSV→prose so retrieval works on header + values
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const headers = lines[0].split(",").map((h) => h.trim());
      const body = lines.slice(1).map((line) => {
        const cells = line.split(",");
        return headers.map((h, i) => `${h}: ${(cells[i] ?? "").trim()}`).join(" | ");
      }).join("\n");
      return `CSV columns: ${headers.join(", ")}\n\n${body}`;
    }
  }
  return raw;
}
