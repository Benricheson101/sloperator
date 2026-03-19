import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {generateText, type ModelMessage, stepCountIs} from 'ai';
import {createOllama} from 'ai-sdk-ollama';

import {config} from './config';
import {webSearch} from './tools/webSearch';

export type Role = 'user' | 'assistant' | 'system';

export class AIService {
  private openrouter: ReturnType<typeof createOpenRouter>;
  private ollama: ReturnType<typeof createOllama>;

  private isLocal = config.provider.base_url.includes('localhost');

  readonly systemPrompt: string;

  constructor() {
    this.openrouter = createOpenRouter({
      apiKey: config.provider.api_key,
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
    messages: ModelMessage[];
    context: {
      botUsername: string;
      serverName: string;
      channelName: string;
      channelDescription: string;
    };
  }) {
    const modelName = config.model.name;

    const systemPrompt = this.systemPrompt
      .replaceAll('{{BOT_USERNAME}}', context.botUsername)
      .replaceAll('{{SERVER_NAME}}', context.serverName)
      .replaceAll('{{CHANNEL_NAME}}', context.channelName)
      .replaceAll('{{CHANNEL_DESCRIPTION}}', context.channelDescription)
      .replaceAll('{{MODEL}}', modelName);

    const result = await generateText({
      model: (this.isLocal ? this.ollama : this.openrouter)(modelName, {}),
      system: systemPrompt,
      messages: messages.slice(-config.model.max_history!),
      maxOutputTokens: config.model.max_output,
      tools: {
        search_web: webSearch,
      },
      stopWhen: stepCountIs(3),
    });

    console.dir(result.usage, {depth: null});

    const toolCalls = result.toolCalls?.map(call => ({
      name: call.toolName,
      input: call.input,
    }));

    return {
      text: result.text || 'Failed :(',
      toolCalls,
      usage: {
        outputTokens: result.totalUsage.outputTokens,
        inputTokens: result.totalUsage.inputTokens,
        cost: result.steps
          .map(s =>
            'cost' in s.usage && typeof s.usage.cost === 'number'
              ? s.usage.cost
              : 0
          )
          .reduce((a, c) => a + c, 0),
      },
    };
  }

  async generateTitle(messages: ModelMessage[]): Promise<string> {
    const modelName = config.model.small_model || config.model.name;

    const titlePrompt = `Generate a short, descriptive title for this conversation. Max 100 characters. No quotes. Just the title.`;

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
  }
}
