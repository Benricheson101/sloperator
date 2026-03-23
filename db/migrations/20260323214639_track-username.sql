-- migrate:up
alter table messages add column username text;
alter table messages add column nickname text;

-- migrate:down
alter table messages drop column username;
alter table messages drop column nickname;
