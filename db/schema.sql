CREATE TABLE "schema_migrations" (version varchar(128) primary key);
CREATE TABLE messages (
  id integer primary key, -- discord message id
  content text,
  discord_author_id bigint not null,
  discord_guild_id bigint not null,
  parent integer,
  role text not null check(role in ('user', 'assistant')),
  image_url text
, username text, nickname text);
CREATE TABLE server_knowledge (
  id integer primary key,
  content text not null,
  discord_guild_id integer not null,
  category text not null
);
CREATE VIRTUAL TABLE server_knowledge_embeddings using vec0(
  id integer primary key, -- matches up with server_knowledge.id
  embedding float[4096]
);
CREATE TABLE "server_knowledge_embeddings_info" (key text primary key, value any);
CREATE TABLE "server_knowledge_embeddings_chunks"(chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,size INTEGER NOT NULL,validity BLOB NOT NULL,rowids BLOB NOT NULL);
CREATE TABLE "server_knowledge_embeddings_rowids"(rowid INTEGER PRIMARY KEY AUTOINCREMENT,id,chunk_id INTEGER,chunk_offset INTEGER);
CREATE TABLE "server_knowledge_embeddings_vector_chunks00"(rowid PRIMARY KEY,vectors BLOB NOT NULL);
-- Dbmate schema migrations
INSERT INTO "schema_migrations" (version) VALUES
  ('20260323154300'),
  ('20260323214639'),
  ('20260326215409');
