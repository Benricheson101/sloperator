import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  embed,
  embedMany,
  generateText,
  type ModelMessage,
  type SystemModelMessage,
  stepCountIs,
  streamText,
} from 'ai';
import {createOllama} from 'ai-sdk-ollama';
import type {GuildMember} from 'discord.js';

import {config} from './config';
import type {Database, DBMessage} from './db';
import {discordMessageTools} from './tools/discordMessage';
import {ragTools} from './tools/rag';
import {currentTime} from './tools/time';
import {webSearch} from './tools/webSearch';

export type Role = 'user' | 'assistant' | 'system';

const TOOLS = {
  search_web: webSearch,
  get_current_time: currentTime,
};

export class AIService {
  private openrouter: ReturnType<typeof createOpenRouter>;
  private ollama: ReturnType<typeof createOllama>;

  private isLocal = config.provider.base_url.includes('localhost');

  readonly systemPrompt: string;
  sending = new Map<string, Set<AbortController>>();

  constructor() {
    this.openrouter = createOpenRouter({
      apiKey: config.provider.api_key,
      extraBody: {
        provider: config.model.provider?.length
          ? {
              order: config.model.provider,
              allow_fallbacks: false,
            }
          : undefined,
        reasoning: {
          max_tokens: 1_000,
        },
      },
    });

    this.ollama = createOllama({
      baseURL: config.provider.base_url,
    });

    this.systemPrompt = config.provider.system_prompt;
  }

  async generateText({
    messages,
    context,
  }: {
    messages: DBMessage[];
    context: {
      replyingToMsgID: string;
      botUsername: string;
      serverName: string;
      channelName: string;
      channelDescription: string;
      member: GuildMember;
      db: Database;
    };
  }): Promise<{
    text: string;
    toolCalls: {name: string; input: unknown}[];
    usage: {
      provider: string;
      in: number;
      out: number;
      reasoning: number;
      cached: number;
      total: number;
      cost: number;
    };
  }> {
    const convo: ModelMessage[] = await Promise.all(
      messages.slice(-config.model.max_history!).map(
        async (m, i, a) =>
          <ModelMessage>{
            role: m.role,
            content: [
              m.image_url &&
                i >= a.length - 8 && {
                  type: 'image',
                  image: this.isLocal
                    ? await fetch(m.image_url).then(r => r.arrayBuffer())
                    : new URL(m.image_url),
                },

              m.content && {
                type: 'text',
                text:
                  m.role === 'user'
                    ? `[Username: "${m.username || '<unknown>'}", Nickname: "${m.nickname || m.username || '<unknown>'}"]: ${m.content}`
                    : m.content,
              },
            ].filter(Boolean),
          }
      )
    );

    const hasImage = convo.some(
      c => Array.isArray(c.content) && c.content.some(c => c.type === 'image')
    );

    const modelName =
      hasImage && config.model.image_model
        ? config.model.image_model
        : config.model.name;

    const systemPrompt = this.systemPrompt
      .replaceAll('{{BOT_USERNAME}}', context.botUsername)
      .replaceAll('{{SERVER_NAME}}', context.serverName)
      .replaceAll('{{CHANNEL_NAME}}', context.channelName)
      .replaceAll('{{CHANNEL_DESCRIPTION}}', context.channelDescription)
      .replaceAll('{{MODEL}}', modelName);

    const contextPrompt: SystemModelMessage = {
      role: 'system',
      content: [
        '## Environment Context',
        `- Your username: ${context.botUsername}`,
        `- Server name: ${context.serverName}`,
        `- Channel name: ${context.channelName}`,
        `- Channel description: ${context.channelDescription}`,
        `- Model: ${modelName}`,
      ].join('\n'),
    };

    const ac = new AbortController();
    let sendingSet = this.sending.get(context.replyingToMsgID);
    if (!sendingSet) {
      sendingSet = new Set();
      this.sending.set(context.replyingToMsgID, sendingSet);
    }
    sendingSet.add(ac);

    // TODO: add retry
    const result = await generateText({
      model: (this.isLocal ? this.ollama : this.openrouter)(modelName),
      system: systemPrompt,
      messages: [contextPrompt, ...convo],
      maxOutputTokens: config.model.max_output,
      abortSignal: ac.signal,
      tools: {
        ...TOOLS,
        ...discordMessageTools(context.member),
        ...ragTools(context.member, context.db, this),
      },
      stopWhen: [
        stepCountIs(10),
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              (c.usage.inputTokenDetails.noCacheTokens ||
                c.usage.totalTokens ||
                0) + a,
            0
          ) > 20_000,
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              ((c.providerMetadata?.openrouter?.usage as {cost?: number})
                ?.cost || 0) + a,
            0
          ) > 0.01,
      ],
      temperature: 0.9,
      topP: 0.93,
    });

    sendingSet.delete(ac);
    if (!sendingSet.size) {
      this.sending.delete(context.replyingToMsgID);
    }

    console.dir(result, {depth: null});

    const toolCalls = result.toolCalls?.map(call => ({
      name: call.toolName,
      input: call.input,
    }));

    if (!result.text) {
      console.error('No text');
      throw new Error('No text', {cause: result});
    }

    return {
      text: result.text || 'Failed :(',
      toolCalls,
      usage: {
        provider: this.isLocal
          ? 'ollama (local)'
          : (result.providerMetadata?.openrouter?.provider as string) ||
            'unknown',
        in: result.totalUsage.inputTokens || 0,
        out: result.totalUsage.outputTokens || 0,
        reasoning: result.totalUsage.outputTokenDetails.reasoningTokens || 0,
        cached: result.totalUsage.inputTokenDetails.cacheReadTokens || 0,
        total: result.totalUsage.totalTokens || 0,
        cost:
          (result?.providerMetadata?.openrouter?.usage as {cost?: number})
            ?.cost || 0,
      },
    };
  }

  async *genText({
    messages,
    context,
  }: {
    messages: DBMessage[];
    context: {
      replyingToMsgID: string;
      botUsername: string;
      serverName: string;
      channelName: string;
      channelDescription: string;
      member: GuildMember;
      db: Database;
    };
  }) {
    const convo: ModelMessage[] = await Promise.all(
      messages.slice(-config.model.max_history!).map(
        async (m, i, a) =>
          <ModelMessage>{
            role: m.role,
            content: [
              m.image_url &&
                i >= a.length - 8 && {
                  type: 'image',
                  image: this.isLocal
                    ? await fetch(m.image_url).then(r => r.arrayBuffer())
                    : new URL(m.image_url),
                },

              m.content && {
                type: 'text',
                text:
                  m.role === 'user'
                    ? `[Username: "${m.username || '<unknown>'}", Nickname: "${m.nickname || m.username || '<unknown>'}"]: ${m.content}`
                    : m.content,
              },
            ].filter(Boolean),
          }
      )
    );

    const hasImage = convo.some(
      c => Array.isArray(c.content) && c.content.some(c => c.type === 'image')
    );

    const modelName =
      hasImage && config.model.image_model
        ? config.model.image_model
        : config.model.name;

    const systemPrompt = this.systemPrompt
      .replaceAll('{{BOT_USERNAME}}', context.botUsername)
      .replaceAll('{{SERVER_NAME}}', context.serverName)
      .replaceAll('{{CHANNEL_NAME}}', context.channelName)
      .replaceAll('{{CHANNEL_DESCRIPTION}}', context.channelDescription)
      .replaceAll('{{MODEL}}', modelName);

    const contextPrompt: SystemModelMessage = {
      role: 'system',
      content: [
        '## Environment Context',
        `- Your username: ${context.botUsername}`,
        `- Server name: ${context.serverName}`,
        `- Channel name: ${context.channelName}`,
        `- Channel description: ${context.channelDescription}`,
        `- Model: ${modelName}`,
      ].join('\n'),
    };

    const ac = new AbortController();
    let sendingSet = this.sending.get(context.replyingToMsgID);
    if (!sendingSet) {
      sendingSet = new Set();
      this.sending.set(context.replyingToMsgID, sendingSet);
    }
    sendingSet.add(ac);

    const llmResult = streamText({
      model: (this.isLocal ? this.ollama : this.openrouter)(modelName),
      system: systemPrompt,
      messages: [contextPrompt, ...convo],
      maxOutputTokens: config.model.max_output,
      abortSignal: ac.signal,
      tools: {
        ...TOOLS,
        ...discordMessageTools(context.member),
        ...ragTools(context.member, context.db, this),
      },
      stopWhen: [
        stepCountIs(10),
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              (c.usage.inputTokenDetails.noCacheTokens ||
                c.usage.totalTokens ||
                0) + a,
            0
          ) > 20_000,
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              ((c.providerMetadata?.openrouter?.usage as {cost?: number})
                ?.cost || 0) + a,
            0
          ) > 0.01,
      ],
      temperature: 0.9,
      topP: 0.93,
    });

    sendingSet.delete(ac);
    if (!sendingSet.size) {
      this.sending.delete(context.replyingToMsgID);
    }

    let text = '';
    const tools: string[] = [];
    const prevReasonings: string[] = [];
    let reasoning = '';
    let lastYield = Date.now();
    let state = 'reasoning';

    const MIN_TIME = 500;

    const keepStates = new Set(['reasoning-delta', 'text-delta', 'tool-call']);
    for await (const part of llmResult.fullStream) {
      if (!keepStates.has(part.type)) {
        continue;
      }

      const prevState = state;
      if (prevState !== part.type) {
        yield {
          state,
          text,
          reasoning,
          tools,
        };

        tools.length = 0;
        prevReasonings.push(reasoning);
        reasoning = '';
        text = '';
        state = part.type;
      }

      switch (part.type) {
        case 'reasoning-delta': {
          reasoning += part.text;
          break;
        }

        case 'text-delta': {
          text += part.text;
          break;
        }

        case 'tool-call': {
          switch (part.toolName) {
            case 'search_web': {
              tools.push(
                `searching the web for "${(part.input as any).query as string}"`
              );
              break;
            }

            case 'query_server_knowledge': {
              tools.push(
                `searching server rules for "${(part.input as any).query as string}`
              );
              break;
            }

            case 'current_time': {
              tools.push(
                `getting the current time in \`${(part.input as any).timezone as string}\``
              );
              break;
            }

            default: {
              tools.push(`\`${part.toolName}\``);
            }
          }
          break;
        }
      }

      const currentTime = Date.now();
      if (currentTime - lastYield >= MIN_TIME) {
        lastYield = currentTime;
        yield {
          state,
          text,
          reasoning,
          tools,
        };
      }
    }

    const providerMetadata = await llmResult.providerMetadata;
    const totalUsage = await llmResult.totalUsage;

    const usage = {
      provider: this.isLocal
        ? 'ollama (local)'
        : (providerMetadata?.openrouter?.provider as string) || 'unknown',
      in: totalUsage.inputTokens || 0,
      out: totalUsage.outputTokens || 0,
      reasoning: totalUsage.outputTokenDetails.reasoningTokens || 0,
      cached: totalUsage.inputTokenDetails.cacheReadTokens || 0,
      total: totalUsage.totalTokens || 0,
      cost: (providerMetadata?.openrouter?.usage as {cost?: number})?.cost || 0,
    };

    yield {
      state: 'finish',
      fullReasoning: prevReasonings,
      fullText: await llmResult.text,
      usage,
    };
  }

  async generateTitle(messages: ModelMessage[]): Promise<string> {
    const modelName = config.model.small_model || config.model.name;

    const titlePrompt = `Generate a short, descriptive title for this conversation. Max 100 characters.`;

    try {
      const result = await generateText({
        model: (this.isLocal ? this.ollama : this.openrouter)(modelName, {}),
        system: titlePrompt,
        messages: messages.slice(-10),
        maxOutputTokens: 20,
        providerOptions: {
          openrouter: {
            reasoning: {
              enabled: false,
            },
          },
        },
      });

      return result.text.slice(0, 100).trim() || 'AI Response';
    } catch (err) {
      console.error('Failed to generate thread title:', err);
      return 'AI Response';
    }
  }

  async getEmbedding(query: string): Promise<number[]> {
    const {embedding} = await embed({
      model: (this.isLocal ? this.ollama : this.openrouter).embedding(
        config.rag.embedding_model,
        {}
      ),
      value: query,
    });

    return embedding;
  }

  async getManyEmbedding(queries: string[]): Promise<number[][]> {
    const {embeddings} = await embedMany({
      model: (this.isLocal ? this.ollama : this.openrouter).embedding(
        config.rag.embedding_model,
        {}
      ),
      values: queries,
    });

    return embeddings;
  }
}
