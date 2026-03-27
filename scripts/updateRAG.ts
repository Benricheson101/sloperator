import { readFileSync } from "node:fs";
import { parse } from "toml";
import { loadConfig } from "../src/config";
import { AIService } from "../src/ai";
import { Database } from "../src/db";

type RAGConfig = {
  discord_guild_id: string;
  entry: RAGEntry[]
};

type RAGEntry = {
  category: string;
  content: string;
}

const loadKnowledge = (path = 'knowledge.toml') => {
  const file = readFileSync(path, 'utf8');
  const knowledge = parse(file) as RAGConfig;

  return knowledge;
};

const main = async () => {
  const knowledgeFile = loadKnowledge('./knowledge.toml');
  const config = loadConfig('./config.toml');

  const discordGuildID = BigInt(knowledgeFile.discord_guild_id);

  const ai = new AIService();
  const db = new Database(config.sqlite.path);

  db.db.prepare('delete from server_knowledge_embeddings where id in (select id from server_knowledge where discord_guild_id = ?)').run(discordGuildID);
  db.db.prepare('delete from server_knowledge where discord_guild_id = ?').run(discordGuildID);

  const embeddings = await ai.getManyEmbedding(knowledgeFile.entry.map(e => e.content));

  for (let i = 0; i < embeddings.length; i++) {
    const k = knowledgeFile.entry[i];


    db.insertKnowledge({
      content: k.content,
      category: k.category,
      discord_guild_id: discordGuildID,
      embedding: embeddings[i],
    });

    console.log(`[${i+1}/${embeddings.length}] Inserted ${k.category} item`);
  }
};

main().catch(console.error);
