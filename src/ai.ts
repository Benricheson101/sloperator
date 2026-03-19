import {createOpenRouter} from '@openrouter/ai-sdk-provider';
import {
  generateText,
  type ModelMessage,
  type SystemModelMessage,
  stepCountIs,
} from 'ai';
import {createOllama} from 'ai-sdk-ollama';

import {config} from './config';
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

    const result = await generateText({
      model: (this.isLocal ? this.ollama : this.openrouter)(modelName, {}),
      system: systemPrompt,
      messages: [contextPrompt, ...messages.slice(-config.model.max_history!)],
      maxOutputTokens: config.model.max_output,
      tools: TOOLS,
      stopWhen: stepCountIs(3),
    });

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
        in: result.totalUsage.inputTokens || 0,
        out: result.totalUsage.outputTokens || 0,
        reasoning: result.totalUsage.outputTokenDetails.reasoningTokens || 0,
        cached: result.totalUsage.inputTokenDetails.cacheReadTokens || 0,
        total: result.totalUsage.totalTokens || 0,
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
