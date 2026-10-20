<div align="center">

<img src="./docs/brand/wordmark-plate.svg" width="560" alt="open-img generator">

### Every image model. One local studio.

Write one prompt, run it on several image models at once, and keep the results on your own machine.<br>
Works with Qwen, Doubao, Zhipu, SiliconFlow, fal.ai and ZenMux.

[![License](https://img.shields.io/badge/license-Apache--2.0-111111)](LICENSE) ![Node](https://img.shields.io/badge/node-20%20%7C%2022%20%7C%2024-111111) ![Next.js](https://img.shields.io/badge/Next.js-111111?logo=nextdotjs&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-111111?logo=sqlite&logoColor=white) ![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)

**[Quick start](#quick-start)** &nbsp;·&nbsp; **[Providers](#supported-providers)** &nbsp;·&nbsp; **[Features](#features)** &nbsp;·&nbsp; **[Desktop app](#macos-desktop-app)** &nbsp;·&nbsp; **English** · [简体中文](README.zh-CN.md)

<br>

<img src="./docs/images/generate.png" width="900" alt="The Generate page: one prompt sent to Qwen Image 3.0 Pro, Qwen Image 3.0 and Wan 2.7 Image, with the three results in a grid">

</div>

<br>

## Why use it

Each image provider has its own console and its own parameters, so comparing models usually means switching tabs and downloading files by hand. open-img generator puts them in one local app:

- One prompt can go to several models in a single run, and the results come back side by side.
- The form follows each model's limits: the image count, aspect ratios, seed and negative prompt it supports.
- Images, history and settings are stored on your disk. API keys stay on the server and are never sent to the browser.

It runs in the browser (Next.js) and as a macOS desktop app (Electron).

## Quick start

**1 · Use Node.js 24.** Node 20, 22 and 24 LTS are supported, and `.nvmrc` pins 24. Don't use a Current release: the SQLite native module is only tested on LTS.

```sh
nvm install && nvm use
```

<sub>On macOS you can use Homebrew and direnv instead: run `brew install node@24 direnv`, read `.envrc`, then run `direnv allow .`. It only puts Homebrew's `node@24/bin` first on `PATH` inside this folder.</sub>

**2 · Add a provider key.** Copy the example file and fill in at least one key from the [provider table](#supported-providers).

```sh
cp .env.example .env.local
```

**3 · Install and run.**

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create a workspace. `npm run dev` migrates the database before it starts.

<sub>If you installed dependencies under another Node major version, switch to Node 24 and run `npm ci` again so SQLite is rebuilt. If the only error is a `better-sqlite3` `NODE_MODULE_VERSION` mismatch, `npm rebuild better-sqlite3` is enough, and your database is kept.</sub>

## Supported providers

A provider is enabled when its key is set. Providers without a key are skipped without an error. Restart the dev server after you edit `.env.local`.

| Provider | Key in `.env.local` |
| --- | --- |
| fal.ai | `FAL_KEY` |
| ZenMux | `ZENMUX_API_KEY` |
| SiliconFlow | `SILICONFLOW_API_KEY` |
| Zhipu AI | `ZHIPU_API_KEY` |
| Doubao (Volcengine Ark) | `ARK_API_KEY` |
| Qwen (Alibaba DashScope) | `DASHSCOPE_API_KEY` |

[`.env.example`](.env.example) explains the optional settings: regional gateways, a local access token (`APP_AUTH_TOKEN`), image retention and storage paths.

## Features

### Compare models in one run

Choose an aspect ratio, the number of images per model and the models to run, then press Generate. Synchronous and queued providers can run in the same batch. The task panel shows which jobs are running, finished or failed, and the grid labels each image with its provider and model.

### Gallery and history

Click the heart on an image to add it to favorites. **Gallery** shows favorites from every workspace and can filter them by workspace or provider. **History** lists each generation in a session with its prompt, models, status and thumbnails.

<table>
<tr>
<td width="50%"><img src="./docs/images/gallery.png" alt="Gallery: favorite images filtered by workspace and provider"></td>
<td width="50%"><img src="./docs/images/history.png" alt="History: generations with prompt, provider and model, status and thumbnails"></td>
</tr>
</table>

### Workspaces and sessions

A workspace groups related work, and each workspace holds sessions of prompts. The home page lists recent workspaces with their session, generation and image counts.

<img src="./docs/images/home.png" width="900" alt="Home: create a workspace or open a recent one">

### Providers and local data

**Providers** shows which providers are configured, where each credential comes from and how many models are enabled.

App data is stored under `./data/` by default: the SQLite database, generated images, settings and logs. **Settings** shows how much space they use. It can also delete unfavorited images automatically after a set number of days (favorites are never deleted), and export a workspace as a ZIP of images and `history.json` without keys or logs.

<table>
<tr>
<td width="50%"><img src="./docs/images/providers.png" alt="Providers: six providers with key names, status and model counts"></td>
<td width="50%"><img src="./docs/images/settings.png" alt="Settings: retention policy, storage usage and workspace export"></td>
</tr>
</table>

The interface is available in English and Simplified Chinese.

## Production

```sh
npm run build
npm start
```

`npm start` runs the database migration in production mode first.

## macOS desktop app

```sh
npm run desktop:dev                  # run the Electron app in development
npm run desktop:package:mac:arm64    # build a DMG for Apple Silicon
npm run desktop:package:mac:x64      # build a DMG for Intel
```

For signing and notarization, see the [macOS distribution guide](docs/mvp/desktop-shell/macos-distribution.md).

## Development

```sh
npm run typecheck
npm test
npm run build
```

## License

[Apache License 2.0](LICENSE). This license does not cover third-party providers' terms of service, trademarks, or rights to generated content.
