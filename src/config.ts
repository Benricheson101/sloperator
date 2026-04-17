import assert from 'node:assert';
import {readFileSync, type StatWatcher, watchFile} from 'node:fs';

import {parse} from 'toml';

export type ModelConfig = {
  primary_model: string;
  small_model?: string;
  multimodal_model?: string;
  router_model?: string;
  provider?: string[];
  max_history?: number;
  max_output?: number;
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

export type WebSearchConfig = {
  searxng_url: string;
  jina_api_key?: string;
};

export type SQLiteConfig = {
  path: string;
};

export type RAGConfig = {
  embedding_model: string;
};

export type MiscConfig = {
  debug_show_tokens: boolean;
};

export type Config = {
  discord: DiscordConfig;
  provider: ProviderConfig;
  model: ModelConfig;
  web_search: WebSearchConfig;
  sqlite: SQLiteConfig;
  rag: RAGConfig;
  misc: MiscConfig;
};

export let config: Config;
export let watcher: StatWatcher | undefined;

export const loadConfig = (path = 'config.toml') => {
  if (!watcher) {
    watcher = watchFile(path, () => {
      console.log('Config file changed, reloading...');
      loadConfig(path);
    });
  }

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

  if (config.misc?.debug_show_tokens === undefined) {
    config.misc = {debug_show_tokens: false};
  }

  return config;
};

export const isGuildEnabled = (g: string) =>
  config.discord.enabled_guilds.length
    ? config.discord.enabled_guilds.includes(g)
    : true;
