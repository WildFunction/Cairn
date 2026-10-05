[中文](./README.md) | English

[![Release](https://img.shields.io/github/v/release/jiehaoZ/Cairn?label=release)](https://github.com/jiehaoZ/Cairn/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%28untested%29-lightgrey)](#download)
[![Bun](https://img.shields.io/badge/Bun-1.3+-000000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

# Cairn

![Cairn](./docs/images/screenshot.jpg)

https://github.com/user-attachments/assets/cd272d51-46c1-4838-aa74-ab6e3c69cc6f

Cairn turns a book into a series of short narrated clips. How long they run depends on how
deeply you want to know the book.

## Features

- Opens EPUB, PDF, MOBI/AZW3, DOCX, TXT and Markdown. Your own Markdown notes work too.
- Four lengths, from the rough idea to the whole book.
- The path follows the book's table of contents and chapters, not what the model remembers about the book.
- Each station is a set of slides with voice narration and subtitles, laid out as timelines, comparisons, flowcharts, matrices and ten other chart types.
- Progressive loading: station 1 plays as soon as it's ready, and the rest are generated in the background while you listen.
- A companion agent next to the player answers any question about the current book, and links each claim to the passage or web page it came from.

## Download

On an Apple Silicon Mac, install it with [Homebrew](https://brew.sh):

```bash
brew install --cask jiehaoZ/tap/cairn
```

`brew upgrade --cask cairn` picks up new releases. Or get the DMG from the
[latest release](https://github.com/jiehaoZ/Cairn/releases/latest). So far it has only been tested on
Apple Silicon Macs.

**Windows (untested).** Each release also carries a Windows x64 installer, `Cairn-<version>-x64-Setup.zip`:
unzip it and run `Cairn-Setup.exe`, keeping the `.installer` folder beside it. It is built by CI and has never been run on a real Windows machine, so expect rough edges. The installer
is unsigned, so SmartScreen will ask you to confirm with **More info → Run anyway**. Books are stored in `%APPDATA%\Cairn`. If something breaks, please
[open an issue](https://github.com/jiehaoZ/Cairn/issues).

On first launch, open **Settings** and pick a model provider. See [Supported models](#supported-models).

## Supported models

Cairn calls models through [pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai). The
same model can build stations and answer in the companion, or the companion can use its own.

| Provider | How to connect | Default model |
| --- | --- | --- |
| OpenAI | API key (`OPENAI_API_KEY`) | `gpt-6-sol` |
| OpenAI Codex | Your ChatGPT account, signed in with `codex login` | `gpt-6-sol` |
| Anthropic | API key (`ANTHROPIC_API_KEY`) | `claude-haiku-4-5` |
| Google | API key (`GEMINI_API_KEY`) | `gemini-3.8-flash` |
| DeepSeek | API key (`DEEPSEEK_API_KEY`) | `deepseek-flash` |
| OpenRouter | API key (`OPENROUTER_API_KEY`) | `google/gemini-3.8-flash` |
| Groq | API key (`GROQ_API_KEY`) | `qwen/qwen3.8-27b` |
| Custom | Any OpenAI-compatible endpoint, such as a local server | You choose |

A key field can hold the key itself or `$NAME` to read an environment variable. If the chosen
provider has no credentials, Cairn uses the first one that does.

Settings lists only models with constrained (structured) output, where the provider can force the
reply to match a JSON Schema. Building one book takes about a hundred model calls, and each needs
well-formed structured output, so a model that only tries to follow the format is not offered.
xAI, Moonshot and MiniMax are not in the list for now. Newer models are listed first.

## Build from source

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
git clone https://github.com/jiehaoZ/Cairn.git
cd Cairn
bun install
cd apps/desktop && bunx electrobun prepare   # once per checkout

bun run start       # run the app
bun run package     # build a distributable .app
```

`bun test` runs the tests and `bun run typecheck` checks all four TypeScript projects.
[`AGENTS.md`](AGENTS.md) has the rest of the commands and the project's conventions.

## Contributing

Bug reports and ideas are welcome in [issues](https://github.com/jiehaoZ/Cairn/issues). Before a
pull request, read [`AGENTS.md`](AGENTS.md): it lists the checks that must pass and the invariants
the pipeline depends on.

## License

Cairn is released under the [MIT License](./LICENSE).
