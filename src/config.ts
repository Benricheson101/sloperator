import assert from 'node:assert';
import {readFileSync} from 'node:fs';

import {parse} from 'toml';

export type ModelConfig = {
  name: string;
  provider?: string[];
  max_history?: number;
  max_output?: number;
  small_model?: string;
  image_model?: string;
};

export type ProviderConfig = {
  base_url: string;
  api_key: string;
  system_prompt: string;
};

export type DiscordConfig = {
  token: string;
  enabled_guilds: string[];
};

export type SearXNGConfig = {
  url: string;
};

export type SQLiteConfig = {
  path: string;
};

export type RAGConfig = {
  embedding_model: string;
};

export type Config = {
  discord: DiscordConfig;
  provider: ProviderConfig;
  model: ModelConfig;
  searxng: SearXNGConfig;
  sqlite: SQLiteConfig;
  rag: RAGConfig;
};

export let config: Config;

export const loadConfig = (path = 'config.toml') => {
  const configFile = readFileSync(path, 'utf8');
  config = parse(configFile);

  assert(config.discord.token, 'missing discord.token');
  assert(config.provider?.base_url, 'missing provider.base_url');

  // ollama doesn't need an api key so any string works
  if (!config.provider.api_key) {
    config.provider.api_key = ':3';
  }

  if (!config.model.max_history) {
    config.model.max_history = 0;
  }

  if (!config.discord.enabled_guilds) {
    config.discord.enabled_guilds = [];
  }

  if (!config.sqlite.path) {
    config.sqlite.path = ':memory:';
  }

  return config;
};

export const isGuildEnabled = (g: string) =>
  config.discord.enabled_guilds.length
    ? config.discord.enabled_guilds.includes(g)
    : true;
