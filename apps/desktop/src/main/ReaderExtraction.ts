import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";

export interface ExtractedReaderArticle {
  title: string;
  byline?: string;
  lang?: string;
  html: string;
  text: string;
}

export function extractReadableArticle(documentHtml: string, sourceUrl: string, fallbackTitle: string): ExtractedReaderArticle | undefined {
  const parsedDocument = parseHTML(documentHtml).document;
  const article = new Readability(parsedDocument as unknown as Document, { charThreshold: 350 }).parse();
  if (!article?.content || !article.textContent || article.textContent.trim().length < 350) return undefined;
  const makeAttributes = (attributes: Record<string, string>, urlAttribute: "href" | "src") => {
    const url = resolveReaderUrl(attributes[urlAttribute], sourceUrl);
    const next = { ...attributes };
    if (url) next[urlAttribute] = url; else delete next[urlAttribute];
    return next;
  };
  const html = sanitizeHtml(article.content, {
    allowedTags: ["article", "section", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "em", "strong", "b", "i", "u", "s", "ul", "ol", "li", "figure", "figcaption", "img", "a", "br", "hr", "span", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "title", "width", "height"], "*": ["lang", "dir"] },
    allowedSchemes: ["https", "http"], allowProtocolRelative: false, disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attributes) => ({ tagName, attribs: makeAttributes(attributes, "href") }),
      img: (tagName, attributes) => ({ tagName, attribs: makeAttributes(attributes, "src") }),
    },
  });
  if (html.trim().length < 100) return undefined;
  return {
    title: (article.title || fallbackTitle).slice(0, 2_048),
    html,
    text: article.textContent.slice(0, 100_000),
    ...(article.byline ? { byline: article.byline.slice(0, 500) } : {}),
    ...(article.lang ? { lang: article.lang.slice(0, 32) } : {}),
  };
}

function resolveReaderUrl(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
