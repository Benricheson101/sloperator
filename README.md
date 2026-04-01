<h1 align="center">Mira - LLM Chatbot</h1>

Another Discord-based LLM chatbot.

## Features
- RAG-based knowledge, useful for server rules, faq, lore
- Reply chain conversation history
- Image input
- Basic web search (searxng)

## Usage
To start a new thread, mention the bot with a prompt. Reply to the bot to continue the conversation, or ping it again to start a new thread. Replying to another user's message and pinging the bot will insert the replied-to message into the conversation.

```yaml
User: @Mira what time is it in Amsterdam
Bot: It's 5:14PM in Amsterdam right now.
User: What about in San Francisco?
Bot: It's 8:14AM in San Francisco.
```

## Tools
The bot includes a handful of tools that the language models can call:

- `search_web({query: string})`
- `get_current_time({timezone: string})`
- `fetch_discord_message({channelID: string, messsageID: string})`
- `query_server_knowledge({query: string})`

## Message Format and Contextual Data
User messages sent to the LLM are in the format `[Username: "benricheson101", Nickname: "ben"]: content`. This enables the language model to differentiate between multiple users in the same thread. The bot cannot access messages outside of its reply chain. The only exception to this is through the use of the `fetch_discord_message` tool, which lets the LLM access an outside message by its Discord ID (e.g., a user links to a message and asks for its content).

Some basic contextual info is included in each thread:
```md
## Environment Context
- Your username: {{BOT_USERNAME}},
- Server name: {{SERVER_NAME}}
- Channel name: {{CHANNEL_NAME}}
- Channel description: {{CHANNEL_DESCRIPTION}}
- Model: {{MODEL}}
```

### Web Search
Web search is provided by SearXNG. Because it's not a web scraper, it only returns limited information and not full page content. In my testing this is often sufficient for simple queries, but doesn't hold up when extensive research is required.

# Running It
```sh
$ pnpm build
$ DATABASE_URL=sqlite:./db/mira.sqlite3 dbmate up
$ pnpm mira:update-rag
$ pnpm mira:start
```

### With Docker
```sh
$ docker compose up -d searxng
$ docker compose run --rm mira mira:update-rag
$ docker compose up -d
```

## Configuration
`./config.toml`
```toml
[discord]
# discord bot token
token = ""
# list of discord server IDs that the bot can operate in. leave empty to enable everywhere
enabled_guilds = []

[sqlite]
# the path to the sqlite database
path = "./db/mira.sqlite3"

[provider]
# openrouter-compatible API url.
# note: if this contains `localhost`, it will switch from openrouter to ollama for local models
base_url = ""
# openrouter api key
api_key = ""
# system prompt injected in every conversation. environment context is automatically injected after this, but some placeholders are still available to use inside the system prompt as needed:
#   {{BOT_USERNAME}}
#   {{SERVER_NAME}}
#   {{CHANNEL_NAME}}
#   {{CHANNEL_DESCRIPTION}}
#   {{MODEL}}
system_prompt = "You are a helpful assistant."

[model]
# the name of the primary model to use for text chats
name = ""
# optional: openrouter provider `order`
provider = []
# max number of messages in a conversation. if a thread exceeds this number, the oldest messages are removed
max_history = 20
# max output tokens
max_output = 8000
# optional: a different model to use when images are uploaded since not all models are multimodal. falls back to primary model if unset
image_model = ""

[rag]
# the model to use for word embeddings for the RAG tool
embedding_model = ""

[searxng]
# the searxng server url
url = ""
```

`./knowledge/<server_id>.toml`
```toml
[[entry]]
category = "mira-faq"
content = """
Question: Is the bot open source?
Answer: The bot is open source. The source code can be found on GitHub at https://github.com/Benricheson101/mira and is licensed under the MIT license.
"""
```
