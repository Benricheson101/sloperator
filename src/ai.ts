import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  embed,
  embedMany,
  generateText,
  type ModelMessage,
  Output,
  type SystemModelMessage,
  stepCountIs,
  streamText,
} from 'ai';
import {createOllama} from 'ai-sdk-ollama';
import type {GuildMember} from 'discord.js';

import {config} from './config';
import type {Database, DBMessage} from './db';
import {discordMessageTools} from './tools/discordMessage';
import {evalMathExpr} from './tools/math';
import {ragTools} from './tools/rag';
import {currentTime} from './tools/time';
import {getPageContents, webSearch} from './tools/webSearch';

export type Role = 'user' | 'assistant' | 'system';

const TOOLS = {
  search_web: webSearch,
  get_page_contents: getPageContents,
  get_current_time: currentTime,
  evaluate_math_expr: evalMathExpr,
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

  async *streamText({
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
      hasImage && config.model.multimodal_model
        ? config.model.multimodal_model
        : await this.routePrompt(messages);

    const systemPrompt = this.systemPrompt
      .replaceAll('{{BOT_USERNAME}}', context.botUsername)
      .replaceAll('{{SERVER_NAME}}', context.serverName)
      .replaceAll('{{CHANNEL_NAME}}', context.channelName)
      .replaceAll('{{CHANNEL_DESCRIPTION}}', context.channelDescription)
      .replaceAll('{{MODEL}}', modelName);

    const now = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeZone: 'America/New_York',
    }).format(new Date());

    const contextPrompt: SystemModelMessage = {
      role: 'system',
      content: [
        '## Environment Context',
        `- Your username: ${context.botUsername}`,
        `- Server name: ${context.serverName}`,
        `- Channel name: ${context.channelName}`,
        `- Channel description: ${context.channelDescription}`,
        `- Model: ${modelName}`,
        `- Current date: ${now}`,
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
      providerOptions: {
        openrouter: {
          provider: config.model.provider?.length
            ? {
                order: config.model.provider,
                allow_fallbacks: false,
              }
            : undefined,
        },
      },
      system: systemPrompt,
      messages: [contextPrompt, ...convo],
      maxOutputTokens: config.model.max_output,
      abortSignal: ac.signal,
      tools: {
        ...TOOLS,
        ...discordMessageTools(context.member),
        ...ragTools(context.member, context.db, this),
      },
      timeout: {
        totalMs: 90_000,
        stepMs: 45_000,
      },
      stopWhen: [
        stepCountIs(20),
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              (c.usage.inputTokenDetails.noCacheTokens ||
                c.usage.totalTokens ||
                0) + a,
            0
          ) > 50_000,
        ({steps}) =>
          steps.reduce(
            (a, c) =>
              ((c.providerMetadata?.openrouter?.usage as {cost?: number})
                ?.cost || 0) + a,
            0
          ) > 0.015,
      ],
      // temperature: 0.9,
      topP: 0.93,
      temperature: 1.1,
      frequencyPenalty: 0.1,
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
      if (part.type === 'finish') {
        console.log('finished because:', part.finishReason);
      }

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

            case 'get_page_contents': {
              tools.push(`reading <${(part.input as any).url as string}>`);
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

  // async generateTitle(messages: ModelMessage[]): Promise<string> {
  //   const modelName = config.model.small_model || config.model.name;
  //
  //   const titlePrompt = `Generate a short, descriptive title for this conversation. Max 100 characters.`;
  //
  //   try {
  //     const result = await generateText({
  //       model: (this.isLocal ? this.ollama : this.openrouter)(modelName, {}),
  //       system: titlePrompt,
  //       messages: messages.slice(-10),
  //       maxOutputTokens: 20,
  //       providerOptions: {
  //         openrouter: {
  //           reasoning: {
  //             enabled: false,
  //           },
  //         },
  //       },
  //     });
  //
  //     return result.text.slice(0, 100).trim() || 'AI Response';
  //   } catch (err) {
  //     console.error('Failed to generate thread title:', err);
  //     return 'AI Response';
  //   }
  // }

  async getEmbedding(query: string): Promise<number[]> {
    const {embedding} = await embed({
      model: (this.isLocal ? this.ollama : this.openrouter).textEmbeddingModel(
        config.rag.embedding_model
      ),
      value: query,
    });

    return embedding;
  }

  async getManyEmbedding(queries: string[]): Promise<number[][]> {
    const {embeddings} = await embedMany({
      model: (this.isLocal ? this.ollama : this.openrouter).textEmbeddingModel(
        config.rag.embedding_model
      ),
      values: queries,
    });

    return embeddings;
  }

  async routePrompt(messages: DBMessage[]) {
    if (
      !config.model.enable_routing ||
      !config.model.small_model ||
      !config.model.router_model ||
      config.model.primary_model === config.model.small_model
    ) {
      return config.model.primary_model;
    }
    try {
      const out = await generateText({
        model: (this.isLocal ? this.ollama : this.openrouter)(
          config.model.router_model
        ),
        providerOptions: {
          openrouter: {
            reasoning: {
              enabled: false,
            },
          },
        },
        system: `You are a prompt classification engine. Analyze the user's request.
If the request is a simple greeting, casual chat, roleplay, or a meaningless message, output exactly 'easy'
Otherwise output exactly 'hard'`,
        messages,
        output: Output.choice({
          options: ['hard', 'easy'],
        }),
        stopWhen: stepCountIs(1),
        timeout: 1_000,
      });

      switch (out.output) {
        case 'hard': {
          return config.model.primary_model;
        }

        default: {
          return config.model.small_model || config.model.primary_model;
        }
      }
    } catch (err) {
      console.error('Failed to route prompt:', err);
      return config.model.primary_model;
    }
  }
}
