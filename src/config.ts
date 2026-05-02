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
  enable_routing: boolean;
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

export type TranscriptionConfig = {
  use_modal: boolean;
  endpoint: string;
  api_key: string;
};

export type Config = {
  discord: DiscordConfig;
  provider: ProviderConfig;
  model: ModelConfig;
  web_search: WebSearchConfig;
  sqlite: SQLiteConfig;
  rag: RAGConfig;
  misc: MiscConfig;
  transcription: TranscriptionConfig;
};

export let config: Config;
export let watcher: StatWatcher | undefined;

export const loadConfig = (path = 'config.toml', watch = true) => {
  if (!watcher && watch) {
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

  if (config.model.enable_routing === undefined) {
    config.model.enable_routing = !!config.model.router_model;
  }

  if (config.transcription.use_modal === undefined) {
    config.transcription.use_modal = !!config.transcription.endpoint;
  }

  console.log('Loaded config:');
  console.log('  => primary model:   ', config.model.primary_model);
  console.log('  => multimodal model:', config.model.multimodal_model);
  console.log('  => small model:     ', config.model.small_model);
  console.log('  => router model:    ', config.model.router_model);
  console.log('  => enable routing:  ', config.model.enable_routing);
  console.log(
    '  => transcription:   ',
    config.transcription.use_modal ? 'modal' : 'openrouter'
  );

  return config;
};

export const isGuildEnabled = (g: string) =>
  config.discord.enabled_guilds.length
    ? config.discord.enabled_guilds.includes(g)
    : true;
