<!-- fork-overview:start -->

# Paseo++

Paseo++ is [RyanEwen/paseo](https://github.com/RyanEwen/paseo), an experimental fork of
[Paseo](https://github.com/getpaseo/paseo). It includes upstream changes plus these additions:

- **More sidebar control:** Choose filtering, grouping, and sorting independently, including
  project names, workspace names, status, and custom ordering. Show agent activity and code-change
  totals together.
- **Chrome extensions in the desktop browser:** Install and manage extensions, use toolbar
  popups and extension context menus, and open extension windows. Compatibility depends on the
  Chrome APIs an extension uses.
- **Browser automation in the background:** Agents can continue interacting with desktop browser
  tabs while the pane is hidden, the app is unfocused, or its window is minimized.
- **SSH hosts on Android:** Connect to a remote daemon with an imported private key and optional
  passphrase. Verify the server fingerprint before connecting; saved credentials are encrypted
  on your phone. Android does not require the Paseo relay for SSH connections.
- **Explicit branch and worktree choices:** Choose how a workspace uses an existing branch or
  creates a new one. Retry failed setup without losing the checkout created for it.
- **Use existing worktrees:** Adopt a checkout without creating another worktree. The first agent
  starts in the selected checkout, preserving any working subdirectory.
- **Clearer workspace pickers:** Host, project, checkout, and branch choices follow the setup
  order and include explanations. Projects remain available when their workspaces are pinned.
- **Notifications open the right chat:** Chat notifications open their owning workspace,
  including older notifications without a workspace link. Windows banners and Notification
  Center entries retain their chat targets across app restarts.
- **Independent standalone daemons:** Run a Linux or WSL daemon alongside upstream Paseo with
  its own settings, host identity, agents, and workspaces. Install it with `paseo-plus-plus` and
  use the app's host **Update** action to receive newer published Paseo++ previews.
- **Android preview updates:** Get notified when a new preview is available, or check from
  Settings. Download and install it from the app with Android's approval. Downloads are verified
  before installation.
- **Android plugin video:** Plugins can display encoded video in workspace panels on Android.
  A plugin that supplies the video is required.
- **Steadier reading on desktop and web:** Text already visible below an image stays in place
  when the image finishes loading at a shorter height.
- **Mobile refinements:** A larger tab-switcher touch target and notification delivery kept
  separate between development and production apps.

## Install Paseo++

Download desktop and Android previews from [Paseo++ releases](https://github.com/RyanEwen/paseo/releases).
Builds are available for Windows and Linux (x64 and ARM64), plus Android. Windows and Linux AppImage
previews receive updates from Paseo++ releases. The desktop app includes its own daemon.
macOS is deferred until Apple signing is available;
iOS and hosted web are excluded. The upstream overview farther down retains upstream download
links and installation commands.

Paseo++ desktop and Android apps keep their own settings and identities, separate from upstream
Paseo. Set up your hosts and preferences independently in each app. The desktop app also keeps its
bundled daemon separate from the standalone daemon.

### Standalone daemon (Linux and WSL)

Install Node.js 22 or newer and at least one agent CLI. Download the matching
`paseo-daemon-<version>-linux-<arch>.tgz` from [Paseo++ releases](https://github.com/RyanEwen/paseo/releases).
Use `x64` for Intel/AMD or `arm64` for ARM. Linux packages require glibc; Alpine/musl is unsupported.

Install the downloaded package, then start the daemon:

```bash
npm install -g ./paseo-daemon-<version>-linux-<arch>.tgz
paseo-plus-plus daemon run
```

Keep that terminal open, or use `paseo-plus-plus daemon run` as your service's command.
The standalone daemon keeps its settings, host identity, agents, and workspaces in
`~/.paseo-plus-plus` and listens on `127.0.0.1:6791`. Upstream Paseo and Paseo++ can run side by
side with their defaults. Set up the new daemon independently and connect your app to it.
These defaults apply to previews built with the `paseo-plus-plus` command.

Use the app's host **Update** action to install newer published Paseo++ daemon previews.
Source-built daemons need to switch to a release package to use this update path.

<!-- fork-overview:end -->

---

<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Paseo logo">
</p>

<h1 align="center">Upstream Paseo</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/getpaseo/paseo/stargazers">
    <img src="https://img.shields.io/github/stars/getpaseo/paseo?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/getpaseo/paseo/releases">
    <img src="https://img.shields.io/github/v/release/getpaseo/paseo?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://x.com/moboudra">
    <img src="https://img.shields.io/badge/%40moboudra-555?logo=x" alt="X">
  </a>
  <a href="https://discord.gg/jz8T2uahpH">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
  <a href="https://www.reddit.com/r/PaseoAI/">
    <img src="https://img.shields.io/badge/Reddit-555?logo=reddit" alt="Reddit">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents.</p>

<p align="center">
  <img src="https://paseo.sh/hero-mockup.png" alt="Paseo app screenshot" width="100%">
</p>

<p align="center">
  <img src="https://paseo.sh/mobile-mockup.png" alt="Paseo mobile app" width="100%">
</p>

Paseo is an open source agentic development environment for desktop, mobile, web, and CLI. Open the desktop app and work: agents, editor, terminals, diffs, pull requests, and a browser in one window. Run many agents at once, each in its own worktree, on one machine or several. The mobile app is the full app, native on iOS and Android.

- **Parallel agents:** Run many agents at once, each in its own worktree.
- **Built-in orchestration:** Agents in Paseo can create worktrees, launch other agents, and talk to them, across providers.
- **Complete development workflow:** Edit files, review diffs, open pull requests, and run terminals, in split panes you arrange how you want.
- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Paseo doesn't have any telemetry, tracking, or forced log-ins.

[Run parallel tasks in Paseo](https://paseo.sh/docs/parallel-development): start agents in separate worktrees, review their diffs, run each app, and check it in the built-in browser.

## Plugins

Plugins run on the daemon and show up in every client you connect, with the same UI on desktop, web,
iOS, and Android. Write a plugin once and it is on your phone.

- **UI:** screens, sidebar items, workspace panels, Command Center items, slash commands, composer pills, attachment sources, timeline items, themes.
- **Agent lifecycle:** change configuration, environment, and MCP servers, answer permissions, follow up when a turn ends.
- **Providers:** add a coding agent as a provider.

Install from the registry with `paseo plugin add owner/slug`, or from Git or a local directory.

**[Browse plugins](https://paseo.sh/plugins)** · **[Plugin docs](https://paseo.sh/docs/plugins)**

Plugins run with access to your daemon machine and inside connected clients; install only code you trust.

## Getting Started

Paseo runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)
- [Antigravity](https://paseo.sh/docs/supported-providers#antigravity)
- [Muse Code](https://paseo.sh/docs/muse-code)

### Desktop app (recommended)

Download it from [paseo.sh/download](https://paseo.sh/download) or the [GitHub releases page](https://github.com/getpaseo/paseo/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### Server

For a server, a VM, or any machine without the desktop app. Install the CLI and start the daemon:

```bash
npm install -g @getpaseo/cli
paseo
```

Paseo starts, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. The desktop, mobile, and web apps connect to this daemon like any other host.

For full setup and configuration, see:

- [Docs](https://paseo.sh/docs)
- [Connectivity guide](https://paseo.sh/docs/connectivity)
- [Configuration reference](https://paseo.sh/docs/configuration)

### Docker

Run the Paseo daemon and self-hosted web UI in Docker:

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/paseo` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
paseo run --provider claude/opus-4.6 "implement user authentication"
paseo run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

paseo ls                           # list running agents
paseo attach abc123                # stream live output
paseo send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
paseo run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://paseo.sh/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@getpaseo/client`:

```ts
import { createPaseoClient } from "@getpaseo/client";

const client = createPaseoClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://paseo.sh/docs/sdk/quickstart), [recipes](https://paseo.sh/docs/sdk/recipes), and [API reference](https://paseo.sh/docs/sdk/reference).

## Skills

Skills teach your agent to use Paseo to orchestrate other agents.

```bash
npx skills add getpaseo/paseo
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Paseo daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `paseo` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation (`paseo.sh`)

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Sponsors

Paseo is an independent project used by tens of thousands of developers daily, built by one person and funded by the people who use it. Support the work on [GitHub Sponsors](https://github.com/sponsors/boudra). Companies can [sponsor Paseo](https://paseo.sh/sponsor#spot) monthly and have their logo shown here and on the paseo.sh homepage.

<!-- Sponsor logos go here, in the same order as packages/website/src/data/sponsors.ts -->

## Related projects

- [getpaseo/paseo-relay](https://github.com/getpaseo/paseo-relay) — official distributed relay, written in Elixir
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension

## License

Apache-2.0
