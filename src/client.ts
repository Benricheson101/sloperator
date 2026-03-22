import {ActivityType, Client, GatewayIntentBits} from 'discord.js';

export class DiscordClient extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],

      presence: {
        activities: [
          {
            type: ActivityType.Custom,
            name: 'beep boop',
          },
        ],
      },
    });
  }
}
