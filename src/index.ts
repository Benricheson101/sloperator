import {clearInterval, setInterval} from 'node:timers';

import {
  ChannelType,
  cleanContent,
  type Message,
  MessageFlags,
  Routes,
  type TextChannel,
} from 'discord.js';

import {AIService} from './ai';
import {DiscordClient} from './client';
import {isGuildEnabled, loadConfig} from './config';
import {Database} from './db';
import {transcribe} from './transcribe';
import {getAudioAttachments, hasAudioAttachment} from './util/attachments';
import {sendMessage} from './util/message';

const config = loadConfig('./config.toml');
const discord = new DiscordClient();
const ai = new AIService();
const db = new Database(config.sqlite.path);

let BOT_PING_REGEX: RegExp;

discord.on('clientReady', () => {
  BOT_PING_REGEX = new RegExp(`<@!?${discord.user!.id}>`, 'g');
  console.log(`Logged in as ${discord.user?.tag}`);
});

discord.on('messageCreate', async msg => {
  try {
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
      if (!msg.flags.has(MessageFlags.IsVoiceMessage)) {
        return;
      }

      msg.attachments.first()!.contentType;

      const [reply, transcribed] = await Promise.allSettled([
        msg.reply({
          content: '-# transcribing...',
          allowedMentions: {
            parse: [],
            repliedUser: false,
          },
        }),
        transcribe(msg.attachments.first()!.url),
      ]);

      if (reply.status === 'rejected') {
        return;
      }

      if (transcribed.status === 'rejected') {
        console.error('Failed to transcribe message:', transcribed.reason);
        reply.value.edit({
          content: '-# :x: failed to transcribe message',
          allowedMentions: {
            parse: [],
            repliedUser: false,
          },
        });

        return;
      }

      reply.value
        .edit({
          content: transcribed.value.text,
          allowedMentions: {
            parse: [],
            repliedUser: false,
          },
        })
        .catch(() => console.error('failed to edit message'));

      // TODO: insert this without text then update it?
      db.insertTranscription(
        BigInt(msg.id),
        transcribed.value.text,
        BigInt(msg.author.id),
        BigInt(reply.value.id)
      );

      return;
    }

    const isReplyInConvo =
      !!msg.reference?.messageId &&
      db.isInConvo(BigInt(msg.reference!.messageId!));

    if (isPing && isReplyToOther && !isReplyToBot) {
      const repliedMsg = await msg.fetchReference();
      db.insertDiscordMessage(repliedMsg);
    }

    const content = cleanContent(
      msg.content.replaceAll(BOT_PING_REGEX, ''),
      msg.channel
    ).trim();

    if (
      (!content && !isReplyToBot && !isReplyToOther) ||
      (isReplyToBot && !isReplyInConvo)
    ) {
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
      const resp = ai.streamText({
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
            text = `:pencil: ${part.text!.slice(-1_800)}`;
            break;
          }

          case 'tool-call': {
            text = part.tools!.map(t => `-# :tools: ${t}`).join('\n');
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
                parse: ['users'],
                repliedUser: true,
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
  } catch (err) {
    console.error('uncaught error in messageCreate handler:', err);
  }
});

discord.on('messageDelete', msg => {
  try {
    // fixme: this doesn't seem to be working properly?
    db.deleteChildren(BigInt(msg.id));
    if (ai.sending.has(msg.id)) {
      for (const ac of ai.sending.get(msg.id)!) {
        ac.abort('parent_message_deleted');
      }

      ai.sending.delete(msg.id);
    }

    // TODO: maybe check db if the message isn't cached?
    if (hasAudioAttachment(msg)) {
      const deleted = db.deleteTranscription(BigInt(msg.id));

      for (const d of deleted) {
        msg.client.rest.delete(
          Routes.channelMessage(
            msg.channel.id,
            d.transcription_message_id.toString()
          )
        );
      }
    }
  } catch (err) {
    console.error('uncaught error in messageDelete handler:', err);
  }
});

discord.on('messageUpdate', async msg => {
  try {
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
  } catch (err) {
    console.error('uncaught error in messageUpdate handler:', err);
  }
});

discord.on('interactionCreate', async i => {
  try {
    if (i.isMessageContextMenuCommand()) {
      if (i.commandName === 'Transcribe') {
        // TODO: what should happen if there's more than one?
        const attachment = getAudioAttachments(i.targetMessage)[0];
        if (!attachment) {
          await i.reply({
            content: ':x: nothing to transcribe!',
            allowedMentions: {
              repliedUser: false,
            },
            flags: MessageFlags.Ephemeral,
          });

          return;
        }

        const rep = await i.deferReply();
        const vmURL = attachment.url;

        try {
          const transcription = await transcribe(vmURL);
          i.editReply({
            content: transcription.text,
            allowedMentions: {
              repliedUser: false,
            },
          });

          db.insertTranscription(
            BigInt(i.targetMessage.id),
            transcription.text,
            BigInt(i.targetMessage.author.id),
            BigInt(rep.id)
          );
        } catch (err) {
          console.error('failed to transcribe voice message in dm:', err);
          i.editReply({
            content: '-# :x: failed to transcribe message',
            allowedMentions: {
              repliedUser: false,
            },
          });
        }

        return;
      }
    }
  } catch (err) {
    console.log('uncaught error in interactionCreate handler:', err);
  }
});

discord.login(config.discord.token);
