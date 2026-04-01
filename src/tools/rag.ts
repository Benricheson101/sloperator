import {tool} from 'ai';
import type {GuildMember} from 'discord.js';
import {z} from 'zod';

import type {AIService} from '../ai';
import type {Database} from '../db';

const getEmbeddingQuery = (query: string) =>
  `Instruct: given a query about a Discord server's rules and FAQs, find the relevant result that answers the query\nQuery: ${query}`;

export const ragTools = (member: GuildMember, db: Database, ai: AIService) => ({
  query_server_knowledge: tool({
    description:
      "Search the Discord server knowledge base for information related to the server, like rules, FAQs, and other server information. Use this when the user asks what's allowed, or other questions about the server. The query should be in the form of a question.",
    inputSchema: z.object({
      query: z
        .string()
        .describe('The specific topic, question, or keywords to look up.'),
      // category: z
      //   .enum(['faq', 'rule', 'all'])
      //   .describe(
      //     "What the question relates most to. Use 'all' if it could be both an faq or rule question"
      //   ),
    }),

    async execute({query}) {
      const ragQuery = getEmbeddingQuery(query);
      const queryEmbedding = await ai.getEmbedding(ragQuery);

      const result = db.queryRag(queryEmbedding, BigInt(member.guild.id));

      if (!result.length) {
        return "No relevant server rules or FAQs were found for this query. Answer using general knowledge, or tell the user you don't have server-specific info on this.";
      }
      // `[Category: ${r.category.toUpperCase()}, Distance: ${r.distance.toFixed(4)}]\n${r.content}`

      const results = result.map(r => ({
        category: r.category,
        distance: r.distance.toFixed(4),
        content: r.content,
      }));

      return results;
    },
  }),
});
