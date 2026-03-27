import {clearInterval, setInterval} from 'node:timers';

import {ChannelType, cleanContent, type TextChannel} from 'discord.js';

import {AIService} from './ai';
import {DiscordClient} from './client';
import {isGuildEnabled, loadConfig} from './config';
import {Database} from './db';
import {sendMessage} from './util/message';

const config = loadConfig('./config.toml');
const discord = new DiscordClient();
const ai = new AIService();
const db = new Database(config.sqlite.path);

let BOT_PING_REGEX: RegExp;

discord.on('clientReady', () => {
  console.log(`Logged in as ${discord.user?.tag}`);
  BOT_PING_REGEX = new RegExp(`<@!?${discord.user!.id}>`, 'g');
});

discord.on('messageCreate', async msg => {
  if (!msg.guild || msg.channel.type === ChannelType.DM || msg.author.bot) {
    return;
  }

  if (!msg.guildId || !isGuildEnabled(msg.guildId)) {
    return;
  }

  const isPing = msg.mentions.has(discord.user!.id);
  const isReplyToBot = msg.mentions.repliedUser?.id === discord.user!.id;
  const isReplyToOther = !!msg.reference?.messageId && !isReplyToBot;

  if (!isPing && !isReplyToBot) {
    return;
  }

  if (
    isPing &&
    isReplyToOther &&
    !db.isInConvo(BigInt(msg.reference!.messageId!))
  ) {
    const repliedMsg = await msg.fetchReference();
    db.insertDiscordMessage(repliedMsg);
  }

  const content = cleanContent(
    msg.content.replaceAll(BOT_PING_REGEX, ''),
    msg.channel
  ).trim();

  if (!content && !isReplyToBot && !isReplyToOther) {
    return;
  }

  db.insertDiscordMessage(msg);

  const convo = db.getConversation(BigInt(msg.id));

  msg.channel.sendTyping();
  const typingInterval = setInterval(
    () => msg.channel.sendTyping(),
    1_000 * 10
  );

  try {
    const response = await ai.generateText({
      messages: convo,
      context: {
        botUsername: discord.user!.username,
        serverName: msg.guild!.name,
        channelName: msg.channel.parent?.name || msg.channel.name,
        channelDescription: (msg.channel as TextChannel).topic || '<none>',
        member: msg.member!,
        db,
      },
    });

    // TODO: should reasoning text be saved for subsequent requests?

    console.dir(response, {depth: null});

    if (!response.text) {
      console.error('no text????');
    }

    const {messages: sentMessages} = await sendMessage({
      ai,
      convo,
      channel: msg.channel as TextChannel,
      response: response.text,
      replyTo: msg,
      usage: response.usage,
    });

    let parentId = msg.id;

    for (const sent of sentMessages) {
      db.insertMessage({
        id: BigInt(sent.id),
        role: 'assistant',
        content: sent.content || '',
        discord_author_id: BigInt(sent.author.id),
        discord_guild_id: BigInt(sent.guildId!),
        parent: BigInt(parentId),
        image_url: null,
        username: sent.author.username || null,
        nickname:
          sent.member?.nickname ||
          sent.author.displayName ||
          sent.author.username ||
          null,
      });
      parentId = sent.id;
    }
  } catch (err) {
    // console.dir(err, {depth: null});
    console.error(err);
    msg.channel.send(':x: An error occurred.');
  } finally {
    clearInterval(typingInterval);
  }
});

discord.on('messageDelete', msg => {
  // fixme: this doesn't seem to be working properly?
  db.deleteChildren(BigInt(msg.id));
});

discord.login(config.discord.token);
