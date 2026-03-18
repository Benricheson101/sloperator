import assert from 'node:assert';
import {readFileSync} from 'node:fs';

import {parse} from 'toml';

export type ModelConfig = {
  name: string;
  max_history?: number;
};

export type OpenAIConfig = {
  base_url: string;
  api_key: string;
  system_prompt: string;
};

export type DiscordConfig = {
  token: string;
  enabled_guilds: string[];
};

export type Config = {
  discord: DiscordConfig;
  openai: OpenAIConfig;
  model: ModelConfig;
};

export let config: Config;

export const loadConfig = (path = 'config.toml') => {
  const configFile = readFileSync(path, 'utf8');
  config = parse(configFile);

  assert(config.discord.token, 'missing discord.token');
  assert(config.openai?.base_url, 'missing openai.base_url');

  // ollama doesn't need an api key so any string works
  if (!config.openai.api_key) {
    config.openai.api_key = ':3';
  }

  if (!config.model.max_history) {
    config.model.max_history = 30;
  }

  if (!config.discord.enabled_guilds) {
    config.discord.enabled_guilds = [];
  }

  return config;
};

export const isGuildEnabled = (g: string) =>
  config.discord.enabled_guilds.length ? config.discord.enabled_guilds.includes(g) : true;
