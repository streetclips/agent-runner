# Agent Runner

A minimal TypeScript runner that executes coding agents inside a Docker sandbox, using a Git worktree as the isolated workspace.

## Usage

```ts
import { claudeCode } from "@alejandrocantero/agent-runner/agents"
import { run } from "@alejandrocantero/agent-runner"
import { dockerSandboxWithClaudeClode } from "@alejandrocantero/agent-runner/sandboxes"
import type { Agent, Sandbox } from "@alejandrocantero/agent-runner/types"

const agent: Agent = claudeCode("claude-sonnet-4-6", {
  effort: "low",
})
const sandbox: Sandbox = dockerSandboxWithClaudeClode()

const result = await run({
  agent,
  sandbox,
  prompt: "Update the README and finish with <promise>COMPLETE</promise>",
  branch: "agent/demo",
  maxIterations: 3,
  // Default: writes agent stdout/stderr to .agent-runner/logs/<branch>-<agent>.log
  // and tees the in-container output to your terminal.
  // Use logging: { type: "file", tee: false } for quiet file-only logging.
  // Use logging: { type: "stdout" } for terminal-only logging.
})

console.log(result)
```

`result.logFilePath` contains the path to the log file when file logging is used.

Run the included example:

```bash
npm run dev
```

## Release

Releases follow the same branch flow as `kanbamd`:

```bash
npm run release -- <major|minor|patch|fix|premajor|preminor|prepatch|prerelease>
```

The release script must run from `dev` with a clean working tree. It runs lint, typecheck, and tests, bumps `package.json`, builds, commits the version bump, pushes `dev`, fast-forwards `main`, and pushes `main`.

Publishing is handled by GitHub Actions on pushes to `main`. Configure the repository secret `NPM_TOKEN` with an npm token that can publish `@alejandrocantero/agent-runner`.
```
