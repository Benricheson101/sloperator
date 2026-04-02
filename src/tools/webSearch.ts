import {tool} from 'ai';
import {z} from 'zod';

import {config} from '../config';

export const webSearch = tool({
  description:
    'Search the web for current events, factual queries, or anything requiring up-to-date information',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),

  async execute({query}) {
    const res: {results: {title: string; url: string; content: string}[]} =
      await fetch(
        `${config.web_search.searxng_url}/search?q=${encodeURIComponent(query)}&format=json`
      ).then(r => r.json());

    return (
      res.results?.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })) ?? []
    ).slice(0, 10);
  },
});

const PAGE_CONTENT_CACHE = new Map<string, string>();

export const getPageContents = tool({
  description:
    'Get the full content of a website. ONLY use this tool if the snippets from your web_search tool did not provide enough information to answer the user fully or the user asks for information about a specific website. Do not use this on video, audio, or Reddit links.',
  inputSchema: z.object({
    url: z.url().describe('The URL to view the contents of'),
  }),

  async execute({url}) {
    // TODO: clear this out so it doesn't hog ram too badly
    if (PAGE_CONTENT_CACHE.has(url)) {
      return PAGE_CONTENT_CACHE.get(url);
    }

    const res = await fetch(
      `https://r.jina.ai/${encodeURIComponent(url.trim())}`,
      {
        headers: {
          authorization: config.web_search.jina_api_key
            ? `Bearer ${config.web_search.jina_api_key}`
            : '',
          'x-remove-selector': 'header, .class, #id',
          'x-retain-images': 'none',
          'x-timeout': '15',
          'x-token-budget': '10000',
        },
      }
    );

    if (!res.ok) {
      const msg = await res.text();
      console.error('Jina failed:', msg);
      return 'Failed to read this webpage. The site might have anti-bot protection. Rely on the search snippets or tell the user you cannot read this specific link.';
    }

    let text = await res.text();

    const MAX_LENGTH = 10_000;
    if (text.length >= MAX_LENGTH) {
      text = `${text.slice(0, MAX_LENGTH)}\n\n[content truncated for length]`;
    }

    PAGE_CONTENT_CACHE.set(url, text);

    return text;
  },
});
