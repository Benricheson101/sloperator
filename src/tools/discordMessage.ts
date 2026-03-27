import {tool} from 'ai';
import {type GuildMember, type Message, PermissionFlagsBits} from 'discord.js';
import {z} from 'zod';

export const discordMessageTools = (member: GuildMember) => ({
  fetch_discord_message: tool({
    description: 'Fetch a message from Discord in the current channel.',
    inputSchema: z.object({
      channelID: z
        .string()
        .describe('The ID of the Discord channel the message is in'),
      messsageID: z.string().describe('The ID of the Discord message to read'),
    }),

    async execute({channelID, messsageID: messageID}) {
      const ch = member.guild.channels.cache.get(channelID);

      if (!ch) {
        return {
          error: 'Unknown channel.',
        };
      }

      if (!ch.isTextBased() || ch.isDMBased()) {
        return {
          error: 'This is not a text channel.',
        };
      }

      const botPermsIn = ch.permissionsFor(ch.client.user.id);
      if (
        !botPermsIn ||
        !botPermsIn.has(
          PermissionFlagsBits.ReadMessageHistory |
            PermissionFlagsBits.ViewChannel
        )
      ) {
        return {
          error: 'Bot does not have access to this message',
        };
      }

      const permsIn = member.permissionsIn(ch.id);
      if (
        !permsIn.has(
          PermissionFlagsBits.ReadMessageHistory |
            PermissionFlagsBits.ViewChannel
        )
      ) {
        return {
          error: 'User does not have permission to access this message.',
        };
      }

      let msg: Message;
      try {
        msg = await ch.messages.fetch(messageID);
        if (!msg) {
          return {
            error: 'Unknown message.',
          };
        }
      } catch (err) {
        console.error('Failed to fetch message:', err);
        return {
          error: err,
        };
      }

      return {
        content: msg.content,
        channel: {
          name: ch.name,
        },
        author: {
          username: msg.author.username,
          displayName:
            msg.member?.nickname ||
            msg.author.displayName ||
            msg.author.username,
        },
      };
    },
  }),
});
