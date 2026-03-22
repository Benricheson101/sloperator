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
        `${config.searxng.url}/search?q=${encodeURIComponent(query)}&format=json`
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
