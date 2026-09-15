export type WebResult = {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  fetched?: boolean;
  fetchMs?: number;
  error?: string;
};

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SEARCH_TIMEOUT_MS = 8_000;
const PAGE_TIMEOUT_MS = 8_000;
const PAGE_TEXT_CAP = 4_000;
const FETCH_HEAD_BYTES = 600_000;
const MAX_RESULTS = 6;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: `"`, apos: `'`, nbsp: " ", middot: "·", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", copy: "©",
};

function decodeEntities(html: string) {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110_000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code < 0x110_000 ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-z][a-z0-9]*);/gi, (raw, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? raw);
}

function stripTags(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, "\n")
      .replace(/<br[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

/** Anchors with a marker class, resolved in document order so each snippet block can be zipped to its link. */
function anchorMatches(html: string, classMarker: RegExp) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ index: match.index ?? 0, attrs: match[1], inner: match[2] }))
    .filter((match) => classMarker.test(match.attrs));
}

function resolveUrl(href: string) {
  const url = href.startsWith("//") ? `https:${href}` : href;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    const redirect = parsed.hostname.endsWith("duckduckgo.com") ? parsed.searchParams.get("uddg") : null;
    const resolved = redirect && /^https?:\/\//i.test(redirect) ? redirect : url;
    return /duckduckgo\.com\/y\.js|\/l\/\?ad_provider|mojeek\.com\/a\//i.test(resolved) ? null : resolved;
  } catch {
    return null;
  }
}

async function searchDuckDuckGo(query: string): Promise<WebResult[]> {
  const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
  const html = await response.text();
  const anchors = anchorMatches(html, /result-link/i);
  const results: WebResult[] = [];
  for (const [index, anchor] of anchors.entries()) {
    const href = /href=["']([^"']+)["']/i.exec(anchor.attrs)?.[1];
    const url = href ? resolveUrl(href) : null;
    if (!url) continue;
    const block = html.slice(anchor.index + anchor.attrs.length, anchors[index + 1]?.index ?? html.length);
    const snippetHtml = /class=["']?result-snippet["']?[^>]*>([\s\S]*?)<\/td>/i.exec(block)?.[1] ?? "";
    const title = stripTags(anchor.inner);
    const snippet = stripTags(snippetHtml);
    if (title && url) results.push({ title: title.slice(0, 160), url, snippet: snippet.slice(0, 400) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function searchMojeek(query: string): Promise<WebResult[]> {
  const response = await fetch(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Mojeek HTTP ${response.status}`);
  const html = await response.text();
  const anchors = anchorMatches(html, /class=["'][^"']*\btitle\b[^"']*["']/i).filter((anchor) => {
    const href = /href=["']([^"']+)["']/i.exec(anchor.attrs)?.[1];
    return Boolean(href && /^https?:\/\//i.test(href) && !/class=["'][^"']*\bnav\b/i.test(anchor.attrs));
  });
  const results: WebResult[] = [];
  for (const [index, anchor] of anchors.entries()) {
    const url = resolveUrl(/href=["']([^"']+)["']/i.exec(anchor.attrs)?.[1] ?? "");
    if (!url) continue;
    const block = html.slice(anchor.index + anchor.attrs.length, anchors[index + 1]?.index ?? html.length);
    const snippet = stripTags(/<p[^>]*class=["'][^"']*\bs\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? "");
    const title = stripTags(anchor.inner);
    if (title && url) results.push({ title: title.slice(0, 160), url, snippet: snippet.slice(0, 400) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function readCapped(response: Response, cap = FETCH_HEAD_BYTES) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function fetchPage(url: string): Promise<{ content?: string; error?: string; ms: number }> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return { error: `HTTP ${response.status}`, ms: Math.round(performance.now() - startedAt) };
    if (!response.headers.get("content-type")?.includes("text/html")) return { error: "not html", ms: Math.round(performance.now() - startedAt) };
    const content = stripTags(await readCapped(response)).slice(0, PAGE_TEXT_CAP);
    return content ? { content, ms: Math.round(performance.now() - startedAt) } : { error: "empty page", ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "fetch failed", ms: Math.round(performance.now() - startedAt) };
  }
}
/** Free web search: DuckDuckGo Lite primary, Mojeek fallback, then in-process page extraction. No API keys, no paid services. */
export type WebSearchOutcome = {
  results: WebResult[];
  engine: "duckduckgo" | "mojeek" | "none";
  searchMs: number;
};

export async function searchWeb(query: string, { pages = 3, maxResults = MAX_RESULTS }: { pages?: number; maxResults?: number } = {}): Promise<WebSearchOutcome> {
  const startedAt = performance.now();
  const trimmed = query.trim().slice(0, 350);
  if (!trimmed) return { results: [], engine: "none", searchMs: 0 };
  let results: WebResult[] = [];
  let engine: WebSearchOutcome["engine"] = "none";
  try {
    results = await searchDuckDuckGo(trimmed);
    if (results.length) engine = "duckduckgo";
  } catch (error) {
    console.warn("[websearch] duckduckgo failed", error instanceof Error ? error.message : error);
  }
  if (!results.length) {
    try {
      results = await searchMojeek(trimmed);
      if (results.length) engine = "mojeek";
    } catch (error) {
      console.warn("[websearch] mojeek failed", error instanceof Error ? error.message : error);
    }
  }
  const searchMs = Math.round(performance.now() - startedAt);
  console.info(`[websearch] engine=${engine} results=${results.length} in ${searchMs}ms query="${trimmed.slice(0, 120)}"`);
  for (const [index, result] of results.entries()) console.info(`[websearch]   ${index + 1}. ${result.title} — ${result.url}`);
  if (!results.length) return { results: [], engine, searchMs };
  const selected = results.slice(0, Math.max(maxResults, pages));
  await Promise.all(selected.slice(0, pages).map(async (result) => {
    const page = await fetchPage(result.url);
    result.content = page.content;
    result.fetched = Boolean(page.content);
    result.fetchMs = page.ms;
    result.error = page.error;
    console.info(`[websearch] page ${page.content ? `${page.content.length} chars` : `FAILED (${page.error ?? "unknown"})`} in ${page.ms}ms — ${result.url}`);
  }));
  return {
    results: selected
      .slice(0, maxResults)
      .map((result) => ({ ...result, snippet: result.snippet || result.content?.slice(0, 300) || "" })),
    engine,
    searchMs,
  };
}

export function formatWebContext(query: string, results: WebResult[]) {
  const sections = results.map((result, index) => {
    const body = result.content ?? result.snippet;
    return `[${index + 1}] ${result.title}\n${result.url}\n${body}`;
  });
  return [
    `Web search results for "${query.trim()}" (retrieved ${new Date().toISOString().slice(0, 10)}):`,
    "",
    ...sections,
    "",
    "Use these results as up-to-date evidence. Cite them inline as [1], [2] where used. If the results do not cover the question, say so and answer from general knowledge.",
  ].join("\n");
}
