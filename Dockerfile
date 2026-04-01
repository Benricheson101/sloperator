FROM node:lts-slim AS build
WORKDIR /usr/src/app

RUN npm i -g corepack@latest
RUN corepack enable

COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
RUN pnpm i

COPY . .
RUN rm -rf db
RUN pnpm build

ENTRYPOINT ["pnpm", "mira:start"]
