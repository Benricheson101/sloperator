import {tool} from 'ai';
import {z} from 'zod';

export const currentTime = tool({
  description: 'Get the current time and date in a timezone (default UTC)',
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe(
        'The timezone to get the time for. e.g., "America/New_York", or "Europe/Amsterdam"'
      ),
  }),

  execute: ({timezone = 'UTC'}) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
    }).format(new Date()),
});
