-- migrate:up
create table transcriptions (
  id integer primary key,
  text text not null,
  discord_author_id integer not null,
  voice_message_id integer not null,
  transcription_message_id integer not null
);

-- migrate:down
drop table transcriptions;
