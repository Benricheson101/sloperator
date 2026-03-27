import {DatabaseSync, type StatementSync} from 'node:sqlite';

import {cleanContent, type Message} from 'discord.js';
import sqliteVec from 'sqlite-vec';

import type {Role} from './ai';
import {getImage} from './util/message';

export type DBMessage = {
  id: bigint;
  content: string;
  discord_author_id: bigint;
  discord_guild_id: bigint;
  parent: bigint | null;
  role: Role;
  image_url: string | null;
  username: string | null;
  nickname: string | null;
};

export type DBRAGKnowledge = {
  id: number;
  content: string;
  category: string;
  discord_guild_id: bigint;
};

export type DBVecMetadata = {
  distance: number;
};

export class Database {
  db: DatabaseSync;

  #isInConvoCache = new Map<bigint, boolean>();

  queries!: {
    insertMessage: StatementSync;
    isInConvo: StatementSync;
    getConversation: StatementSync;
    deleteChildren: StatementSync;
    queryRag: StatementSync;
    insertRagKnowledge: StatementSync;
    insertRagEmbedding: StatementSync;
  };

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, {
      readBigInts: true,
      allowExtension: true,
    });
    sqliteVec.load(this.db);
    this.initQueries();
  }

  getConversation(startID: bigint) {
    const convo = this.queries.getConversation.all(startID) as DBMessage[];
    for (const msg of convo) {
      this.#isInConvoCache.set(msg.id, true);
    }
    return convo;
  }

  insertMessage(msg: DBMessage) {
    this.#isInConvoCache.set(msg.id, true);

    return this.queries.insertMessage.run(
      msg.id,
      msg.content,
      msg.discord_author_id,
      msg.discord_guild_id,
      msg.parent,
      msg.role,
      msg.image_url,
      msg.username,
      msg.nickname
    );
  }

  isInConvo(msgID: bigint): boolean {
    const fromCache = this.#isInConvoCache.get(msgID);
    if (fromCache !== undefined) {
      return fromCache;
    }

    const res = this.queries.isInConvo.get(msgID);
    const isIn = res?.is_in_convo === 1n;
    this.#isInConvoCache.set(msgID, isIn);
    return isIn;
  }

  deleteChildren(msgID: bigint): DBMessage[] {
    const deleted = this.queries.deleteChildren.all(msgID) as DBMessage[];
    for (const msg of deleted) {
      this.#isInConvoCache.set(msg.id, false);
    }

    return deleted;
  }

  insertDiscordMessage(msg: Message) {
    const content = cleanContent(
      msg.content.replaceAll(
        new RegExp(`<@!?${msg.client.user!.id}>`, 'g'),
        ''
      ),
      msg.channel
    ).trim();

    this.insertMessage({
      id: BigInt(msg.id),
      // content: `[Username: "${msg.author.username}", Nickname: "${msg.member?.nickname || msg.author.displayName || msg.author.username}"]: ${content}`,
      content,
      discord_author_id: BigInt(msg.author.id),
      discord_guild_id: BigInt(msg.guildId!),
      parent: BigInt(msg.reference?.messageId || 0) || null,
      role: 'user',
      image_url: getImage(msg),
      username: msg.author.username || null,
      nickname:
        msg.member?.nickname ||
        msg.author.displayName ||
        msg.author.username ||
        null,
    });
  }

  queryRag(embedding: number[], guildID: bigint, threshold = 0.88) {
    return this.queries.queryRag.all(
      JSON.stringify(embedding),
      threshold,
      guildID
    ) as (Pick<DBRAGKnowledge, 'category' | 'content'> &
      Pick<DBVecMetadata, 'distance'>)[];
  }

  insertKnowledge(kn: Omit<DBRAGKnowledge, 'id'> & {embedding: number[]}) {
    const textRow = this.queries.insertRagKnowledge.run(
      kn.content,
      kn.discord_guild_id,
      kn.category
    );
    this.queries.insertRagEmbedding.run(
      textRow.lastInsertRowid,
      JSON.stringify(kn.embedding)
    );
  }

  initQueries() {
    this.queries = {
      insertMessage: this.db.prepare(`
        insert into messages (
          id,
          content,
          discord_author_id,
          discord_guild_id,
          parent,
          role,
          image_url,
          username,
          nickname
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `),

      isInConvo: this.db.prepare(`
        select 1 as is_in_convo
        from messages
        where id = ?
      `),

      getConversation: this.db.prepare(`
        with convo(id) as (
          select id
          from messages
          where id = ?
          union all
          select m.parent
          from convo c
          join messages m
          on c.id = m.id
        )
        select *
        from convo
        inner join messages m
        using(id)
        order by id asc
      `),

      deleteChildren: this.db.prepare(`
        with children(child) as (
          select ?
          union all
          select m.id
          from children c
          join messages m
          on c.child = m.parent
        )
        delete from messages
        where id in children
        returning *;
      `),

      queryRag: this.db.prepare(`
        with knn_matches as (
          select id, distance
          from server_knowledge_embeddings
          where embedding match ?
          and distance < ?
          order by distance asc
          limit 5
        )
        select sk.category, sk.content, knn_matches.distance
        from server_knowledge sk
        inner join knn_matches
        using (id)
        where sk.discord_guild_id = ?
      `),

      insertRagKnowledge: this.db.prepare(`
        insert into server_knowledge (content, discord_guild_id, category)
        values (?, ?, ?)
      `),

      insertRagEmbedding: this.db.prepare(`
        insert into server_knowledge_embeddings (id, embedding)
        values (?, ?)
      `),
    };
  }
}
