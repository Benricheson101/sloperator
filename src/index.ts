import {clearInterval, setInterval} from 'node:timers';

import {
  ChannelType,
  cleanContent,
  type Message,
  MessageFlags,
  type TextChannel,
} from 'discord.js';

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
    let sent: Message | undefined;
    const resp = ai.genText({
      messages: convo,
      context: {
        replyingToMsgID: msg.id,
        botUsername: discord.user!.username,
        serverName: msg.guild!.name,
        channelName: msg.channel.parent?.name || msg.channel.name,
        channelDescription: (msg.channel as TextChannel).topic || '<none>',
        member: msg.member!,
        db,
      },
    });

    let final: any;
    let lastState: string | undefined;
    loop: for await (const part of resp) {
      let text = '';

      // console.log(part);

      switch (part.state) {
        case 'reasoning-delta': {
          if (lastState === 'reasoning-delta') {
            continue loop;
          }
          // text = `-# **Thinking...**\n${part.reasoning!.length > 700 ? '...' : ''}${part.reasoning!
          //   .slice(-700)
          //   .split('\n')
          //   .map(c => (c.trim() ? `-# ${c}` : ''))
          //   .join('\n')}`;
          text = '-# thinking...';
          break;
        }

        case 'text-delta': {
          text = `:pencil: ${part.text!.slice(-1_000)}`;
          break;
        }

        case 'tool-call': {
          text = part.tools!.map(t => `:tools: ${t}`).join('\n');
          break;
        }

        case 'finish': {
          text = part.fullText!;
          final = part;
          break loop;
        }
      }

      lastState = part.state;

      if (!text) {
        continue;
      }

      try {
        if (sent) {
          sent.edit({content: text});
        } else {
          sent = await msg.reply({
            content: text,
            flags: MessageFlags.SuppressEmbeds,
            allowedMentions: {
              parse: [],
              repliedUser: false,
            },
          });
        }
      } catch (err) {
        console.error('failed to send/edit message:', err);
      }
    }

    const {messages: sentMessages} = await sendMessage({
      channel: msg.channel as TextChannel,
      response: final.fullText,
      replyTo: msg,
      firstMsg: sent,
      usage: final.usage as any,
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
    if (
      err !== 'parent_message_deleted' &&
      !(
        err &&
        typeof err === 'object' &&
        'cause' in err &&
        err.cause === 'parent_message_deleted'
      )
    ) {
      console.error(err);
      msg.channel.send(':x: An error occurred.');
    }
  } finally {
    clearInterval(typingInterval);
  }
});

discord.on('messageDelete', msg => {
  // fixme: this doesn't seem to be working properly?
  db.deleteChildren(BigInt(msg.id));
  if (ai.sending.has(msg.id)) {
    for (const ac of ai.sending.get(msg.id)!) {
      ac.abort('parent_message_deleted');
    }

    ai.sending.delete(msg.id);
  }
});

discord.on('messageUpdate', async msg => {
  if (msg.author?.bot) {
    return;
  }

  if (!db.isInConvo) {
    return;
  }

  const m = await msg.fetch(false);

  if (m.content) {
    db.updateMessage(BigInt(msg.id), m.content);
  }
});

discord.login(config.discord.token);
