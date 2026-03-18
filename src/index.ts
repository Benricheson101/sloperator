import {clearInterval, setInterval} from 'node:timers';

import {ChannelType, cleanContent, type TextChannel} from 'discord.js';

import {AIService} from './ai';
import {DiscordClient} from './client';
import {isGuildEnabled, loadConfig} from './config';
import {ConversationManager} from './convo';

const config = loadConfig('./config.toml');
const discord = new DiscordClient();
const cm = new ConversationManager();
const ai = new AIService();

// const isBotMentioned = (content: string) =>
//   content.startsWith(`<@!${discord.user!.id}>`) ||
//   content.startsWith(`<@${discord.user!.id}>`);

let BOT_PING_REGEX: RegExp;

const isBotMentioned = (content: string) => BOT_PING_REGEX.test(content);

discord.on('clientReady', () => {
  console.log(`Logged in as ${discord.user?.tag}`);
  BOT_PING_REGEX = new RegExp(`<@!?${discord.user!.id}>`, 'g');
});

discord.on('threadCreate', async thread => {
  if (!thread.guildId || !isGuildEnabled(thread.guildId)) {
    return;
  }

  const startingMessage = await thread.fetchStarterMessage();
  if (!startingMessage) {
    return;
  }

  const isParentInConvo = cm.messages.has(startingMessage.id);
  if (isParentInConvo) {
    cm.attachThread(thread.id, startingMessage.id);
  }
});

discord.on('messageCreate', async msg => {
  if (!msg.guild || msg.channel.type === ChannelType.DM || msg.author.bot) {
    return;
  }

  if (!msg.guildId || !isGuildEnabled(msg.guildId)) {
    return;
  }

  const isPing = isBotMentioned(msg.content);
  const isReply =
    !!msg.reference?.messageId && cm.messages.has(msg.reference.messageId);

  const threadId = msg.channel.isThread() ? msg.channel.id : undefined;
  const isInAttachedThread = threadId && cm.isThreadAttached(threadId);
  const isFirstInThread = msg.position === 0;

  if (!isPing && !isReply && !isInAttachedThread) {
    return;
  }

  if (isPing && isFirstInThread) {
    cm.attachThread(threadId!, msg.id);
  }

  const content = cleanContent(msg.content.replaceAll(BOT_PING_REGEX, ''), msg.channel).trim();
  if (!content) {
    return;
  }

  if (msg.author.id !== discord.user!.id) {
    cm.addMessage({
      content: `[Username: "${msg.author.username}", Nickname: "${msg.member?.nickname || msg.author.displayName || msg.author.username}"]: ${content}`,
      messageID: msg.id,
      parent: msg.reference?.messageId,
      author: msg.author.username,
      authorID: msg.author.id,
      role: 'user',
      threadID: threadId,
      startOfThread: isPing && !msg.reference,
    });
  }

  let convo: ReturnType<typeof cm.getConversation>;
  if (isInAttachedThread) {
    const rootMsgId = cm.getThreadRoot(threadId!);
    const parentConvo = rootMsgId ? cm.getConversation(rootMsgId) : [];
    const threadMsgs = cm.getThreadMessages(threadId!);
    convo = [...parentConvo, ...threadMsgs];
  } else {
    convo = cm.getConversation(msg.id);
  }

  msg.channel.sendTyping();
  const typingInterval = setInterval(
    () => msg.channel.sendTyping(),
    1_000 * 10
  );

  const response = await ai.generateText({
    messages: convo,
    context: {
      botUsername: discord.user!.username,
      serverName: msg.guild!.name,
      channelName: msg.channel.parent?.name || msg.channel.name,
      channelDescription: (msg.channel as TextChannel).topic || '<none>',
    },
  });

  clearInterval(typingInterval);

  const sent = await msg.reply({
    content: response.text,
    allowedMentions: {},
  });

  cm.addMessage({
    content: response.text,
    author: sent.author.username,
    authorID: sent.author.id,
    messageID: sent.id,
    role: 'assistant',
    startOfThread: false,
    parent: msg.id,
    threadID: msg.channel.isThread() ? msg.channel.id : undefined,
  });
});

discord.on('messageDelete', msg => {
  cm.deleteMessage(msg.id);
});

discord.login(config.discord.token);
