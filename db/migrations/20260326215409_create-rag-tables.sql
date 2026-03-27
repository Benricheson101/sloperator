-- migrate:up
create table server_knowledge (
  id integer primary key,
  content text not null,
  discord_guild_id integer not null,
  category text not null
);

-- dbmate doesn't support extensions. this needs to be run manually prior to running this migration file
create virtual table if not exists server_knowledge_embeddings using vec0(
  id integer primary key references server_knowledge(id) on delete cascade, -- matches up with server_knowledge.id
  embedding float[4096]
);

-- migrate:down
drop table server_knowledge;
-- this too :/
drop table server_knowledge_embeddings;
