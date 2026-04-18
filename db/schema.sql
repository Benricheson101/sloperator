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
CREATE TABLE transcriptions (
  id integer primary key,
  text text not null,
  discord_author_id integer not null,
  voice_message_id integer not null,
  transcription_message_id integer not null
);
-- Dbmate schema migrations
INSERT INTO "schema_migrations" (version) VALUES
  ('20260323154300'),
  ('20260323214639'),
  ('20260326215409'),
  ('20260417015937');
