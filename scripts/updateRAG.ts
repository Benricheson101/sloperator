import {readdirSync, readFileSync, unwatchFile} from 'node:fs';
import path from 'node:path';

import {parse} from 'toml';

import {AIService} from '../src/ai';
import {loadConfig} from '../src/config';
import {Database} from '../src/db';

type RAGConfig = {
  discord_guild_id: string;
  entry: RAGEntry[];
};

type RAGEntry = {
  category: string;
  content: string;
};

const loadKnowledge = (path = 'knowledge.toml') => {
  const file = readFileSync(path, 'utf8');
  const knowledge = parse(file) as RAGConfig;
  return knowledge;
};

const main = async () => {
  const files = readdirSync('./knowledge', {withFileTypes: true});
  const tomlFiles = files.filter(f => f.isFile() && f.name.endsWith('.toml'));

  const config = loadConfig('./config.toml');
  const ai = new AIService();
  const db = new Database(config.sqlite.path);

  for (const file of tomlFiles) {
    const knowledgeFile = loadKnowledge(path.join(file.parentPath, file.name));

    const id =
      /^(\d+)\.toml/.exec(file.name)?.[1] ||
      knowledgeFile.discord_guild_id ||
      '0';
    if (!id) {
      console.error(
        'Cannot find guild ID for knowledge file:',
        file.name,
        'inserting as global knowledge'
      );
    }

    const discordGuildID = BigInt(id);

    db.db
      .prepare(
        'delete from server_knowledge_embeddings where id in (select id from server_knowledge where discord_guild_id = ?)'
      )
      .run(discordGuildID);
    db.db
      .prepare('delete from server_knowledge where discord_guild_id = ?')
      .run(discordGuildID);

    const embeddings = await ai.getManyEmbedding(
      knowledgeFile.entry.map(e => e.content)
    );

    for (let i = 0; i < embeddings.length; i++) {
      const k = knowledgeFile.entry[i];
      db.insertKnowledge({
        content: k.content,
        category: k.category,
        discord_guild_id: discordGuildID,
        embedding: embeddings[i],
      });

      console.log(
        `[${i + 1}/${embeddings.length}] Inserted ${k.category} item`
      );
    }
  }

  db.db.close();
  unwatchFile('./config.toml');
};

main().catch(console.error);
