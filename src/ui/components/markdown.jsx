import { renderMarkdown } from "@/lib/shared";
import { cn } from "@/lib/utils";

/**
 * Agent text as Markdown: markdown-lite escapes everything first and builds only a small, safe subset
 * (paragraphs, lists, code, tables, bold / italic; links show their text) — so its HTML can go in as is.
 */
export function Markdown({ text, className }) {
  return (
    <div
      className={cn("md", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-lite escapes its input before building HTML
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text || "") }}
    />
  );
}
