import type {ModelMessage} from 'ai';
import {
  type Attachment,
  AttachmentBuilder,
  type Message,
  type MessageCreateOptions,
  MessageFlags,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';

import type {AIService} from '../ai';
import {config} from '../config';

type ProseSegment = {text: string; isCode: boolean; codeIndex?: number};

type CodeBlock = {
  content: string;
  language: string;
  startIndex: number;
  endIndex: number;
};

const CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)```/g;
const SENTENCE_END_REGEX = /([.!?。]+[\s\n]+)/g;
const MAX_MESSAGE_LENGTH = 1_800;
const CODE_FILE_THRESHOLD = 800;

const getFileExtension = (language: string): string => {
  const extensionMap: Record<string, string> = {
    js: 'js',
    ts: 'ts',
    typescript: 'ts',
    javascript: 'js',
    py: 'py',
    python: 'py',
    rb: 'rb',
    ruby: 'rb',
    rs: 'rs',
    rust: 'rs',
    go: 'go',
    golang: 'go',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    java: 'java',
    kt: 'kt',
    kotlin: 'kt',
    cs: 'cs',
    'c#': 'cs',
    sh: 'sh',
    bash: 'sh',
    shell: 'sh',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    json: 'json',
    yaml: 'yaml',
    yml: 'yml',
    xml: 'xml',
    sql: 'sql',
    md: 'md',
    markdown: 'md',
    toml: 'toml',
  };

  return extensionMap[language.toLowerCase()] ?? 'txt';
};

export const parseCodeBlocks = (
  content: string,
  threshold: number
): {blocks: CodeBlock[]; prose: ProseSegment[]} => {
  const blocks: CodeBlock[] = [];
  const prose: ProseSegment[] = [];
  let lastIndex = 0;
  let codeIndex = 0;

  let match = CODE_BLOCK_REGEX.exec(content);
  while (match !== null) {
    if (match.index > lastIndex) {
      prose.push({text: content.slice(lastIndex, match.index), isCode: false});
    }

    const blockContent = match[2].trim();
    blocks.push({
      language: match[1] || 'txt',
      content: blockContent,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });

    if (blockContent.length > threshold) {
      prose.push({
        text: `[code: code_${codeIndex}.${getFileExtension(match[1] || 'txt')}]`,
        isCode: true,
        codeIndex,
      });
    } else {
      prose.push({
        text: match[0],
        isCode: true,
        codeIndex,
      });
    }
    codeIndex++;
    lastIndex = match.index + match[0].length;
    match = CODE_BLOCK_REGEX.exec(content);
  }

  if (lastIndex < content.length) {
    prose.push({text: content.slice(lastIndex), isCode: false});
  }

  return {blocks, prose};
};

const splitAtSentenceBoundary = (text: string): string[] => {
  const parts = text.split(SENTENCE_END_REGEX).filter(s => s.trim());
  const messages: string[] = [];
  let current = '';

  for (const part of parts) {
    const withSuffix = part.match(/([.!?。]+)$/);
    const suffix = withSuffix ? withSuffix[1] : '';
    const trimmedPart = part.replace(/([.!?。]+)$/, '');

    if (
      current.length + trimmedPart.length + suffix.length <=
      MAX_MESSAGE_LENGTH
    ) {
      current += trimmedPart + suffix;
    } else {
      if (current) {
        messages.push(current.trim());
      }

      if (trimmedPart.length + suffix.length > MAX_MESSAGE_LENGTH) {
        let remaining = trimmedPart + suffix;
        while (remaining.length > MAX_MESSAGE_LENGTH) {
          messages.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
          remaining = remaining.slice(MAX_MESSAGE_LENGTH);
        }
        current = remaining;
      } else {
        current = trimmedPart + suffix;
      }
    }
  }

  if (current.trim()) {
    messages.push(current.trim());
  }

  return messages.length ? messages : [text.slice(0, MAX_MESSAGE_LENGTH)];
};

export type SendMessageResult = {
  messages: Message[];
  attachments: Attachment[];
};

export const sendMessage = async ({
  ai,
  convo,
  channel,
  response,
  replyTo,
  forceThread,
  usage,
}: {
  ai: AIService;
  convo: ModelMessage[];
  channel: TextChannel | NewsChannel | ThreadChannel;
  response: string;
  replyTo?: Message;
  forceThread?: boolean;
  usage: {
    in: number;
    out: number;
    reasoning: number;
    cached: number;
    total: number;
    cost: number;
  };
}): Promise<SendMessageResult> => {
  const {blocks, prose} = parseCodeBlocks(response, CODE_FILE_THRESHOLD);

  const files: AttachmentBuilder[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.content.length > CODE_FILE_THRESHOLD) {
      const ext = getFileExtension(block.language);
      files.push(
        new AttachmentBuilder(Buffer.from(block.content), {
          name: `code_${i}.${ext}`,
        })
      );
    }
  }

  const content = prose.map(p => p.text).join('');
  const messagesToSend = splitAtSentenceBoundary(content);

  let thread: ThreadChannel | null = null;
  let targetChannel: TextChannel | NewsChannel | ThreadChannel = channel;

  if (messagesToSend.length >= 2 && !channel.isThread() && !forceThread) {
    const textOrNewsChannel = channel as TextChannel | NewsChannel;
    if ('threads' in textOrNewsChannel) {
      const threadTitle = await ai.generateTitle(convo);

      thread = await textOrNewsChannel.threads.create({
        name: threadTitle || 'AI Response',
        autoArchiveDuration: 60,
      });
      targetChannel = thread;
    }
  }

  const messages: Message[] = [];
  const attachments: Attachment[] = [];

  for (let i = 0; i < messagesToSend.length; i++) {
    const isLast = i === messagesToSend.length - 1;
    const hasFiles = isLast && files.length > 0;

    const msgContent =
      messagesToSend[i] +
      (isLast && config.misc.debug_show_tokens
        ? `\n\n-# input: ${usage.in} tokens (${usage.in - usage.cached} uncached, ${usage.cached} cached), output: ${usage.out}. cost: $${usage.cost}. provider: ${usage.provider}`
        : '');

    const msgOptions: MessageCreateOptions = {
      content: msgContent,
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: {parse: ['users'], repliedUser: true},
      ...(hasFiles ? {files} : {}),
    };

    let msg: Message;
    if (i === 0 && replyTo && !thread) {
      msg = await replyTo.reply(msgOptions);
    } else {
      msg = await targetChannel.send(msgOptions);
    }

    // HACK: it adds this to the Conversation so we have to take out the token stats line
    if (isLast) {
      msg.content = messagesToSend[i];
      // msg.content = response;
    }

    messages.push(msg);
    if (msg.attachments.size > 0) {
      attachments.push(...msg.attachments.values());
    }
  }

  return {messages, attachments};
};

export const getImage = (msg: Message) =>
  msg.attachments
    .filter(a => a.contentType?.startsWith('image'))
    .mapValues(v => v.url)
    .first() || null;
