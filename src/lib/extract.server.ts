// Text extractors for the Worker runtime.
// Supports: text/plain/markdown/csv/json/xml/html, PDF (unpdf), DOCX (mammoth), images (vision OCR).

import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export function isTextMime(mime?: string | null): boolean {
  if (!mime) return false;
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml";
}

function looksLikeImage(mime: string, filename: string): boolean {
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/i.test(filename);
}

function looksLikePdf(mime: string, filename: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(filename);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function ocrImageWithVision(blob: Blob, mime: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Image OCR requires OPENROUTER_API_KEY");
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://knowledgescope.ai",
      "X-Title": "KnowledgeScope AI",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this image carefully. Extract ALL visible text verbatim, preserve line breaks, and if the image contains a question or worksheet, include the question, labels, and any answer choices exactly as shown. Output text only, no commentary." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`Vision OCR failed: ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function extractTextFromBlob(blob: Blob, mime: string, filename = ""): Promise<string> {
  const m = (mime || "").toLowerCase();
  const lower = filename.toLowerCase();

  // PDF
  if (looksLikePdf(m, lower)) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const { text } = await extractText(pdf, { mergePages: true });
      const parsed = Array.isArray(text) ? text.join("\n\n") : text;
      if (parsed.trim().length > 0) return parsed;
    } catch (error) {
      console.warn("PDF text extraction failed, falling back to raw text", error);
    }

    const fallback = await blob.text();
    if (fallback.trim().length > 0) return fallback;
    throw new Error("Could not extract readable text from the PDF. If it is a scanned document, try converting it to a text-based PDF or uploading a clearer image.");
  }

  // DOCX
  if (
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const buf = Buffer.from(await blob.arrayBuffer());
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value;
  }

  // HTML
  if (m === "text/html" || lower.endsWith(".html") || lower.endsWith(".htm")) {
    return stripHtml(await blob.text());
  }

  // Images → vision OCR
  if (looksLikeImage(m, lower)) {
    return await ocrImageWithVision(blob, m || blob.type || "image/png");
  }

  // CSV
  if (m === "text/csv" || lower.endsWith(".csv")) {
    const raw = await blob.text();
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const headers = lines[0].split(",").map((h) => h.trim());
      const body = lines.slice(1).map((line) => {
        const cells = line.split(",");
        return headers.map((h, i) => `${h}: ${(cells[i] ?? "").trim()}`).join(" | ");
      }).join("\n");
      return `CSV columns: ${headers.join(", ")}\n\n${body}`;
    }
    return raw;
  }

  // Plain text fallbacks
  if (isTextMime(m) || lower.match(/\.(txt|md|markdown|json|xml|log|yaml|yml|tsv)$/)) {
    return await blob.text();
  }

  // Last resort: try as text
  try {
    const t = await blob.text();
    if (t && /[\x20-\x7E]/.test(t)) return t;
  } catch {}
  throw new Error(`Unsupported file type "${mime || filename}". Try PDF, DOCX, TXT, MD, CSV, JSON, HTML, or an image.`);
}
