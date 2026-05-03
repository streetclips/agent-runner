# Agent Runner

A minimal TypeScript runner that executes coding agents inside a Docker sandbox against any local workspace directory.

## Usage

```ts
import { claudeCode } from "@alejandrocantero/agent-runner/agents"
import { commitAll, deleteWorktree, execInSandbox, runTask } from "@alejandrocantero/agent-runner"
import { dockerSandboxWithClaudeCode } from "@alejandrocantero/agent-runner/sandboxes"
import type { Agent, Sandbox } from "@alejandrocantero/agent-runner/types"

const agent: Agent = claudeCode("claude-sonnet-4-6", {
  effort: "low",
})
const sandbox: Sandbox = dockerSandboxWithClaudeCode()

const result = await runTask({
  agent,
  sandbox,
  prompt: "Update the README",
  workspaceDir: "/path/to/workspace",
  maxIterations: 3,
  hooks: {
    "sandbox-create": async ({ workspaceDir }) => {
      console.log(`Preparing ${workspaceDir}`)
    },
    "agent-start": execInSandbox("npm install"),
    "agent-finish": commitAll({ message: "Agent changes" }),
    "sandbox-close": async ({ status, workspaceDir }) => {
      await deleteWorktree({ worktreeDir: workspaceDir, force: true })
      console.log(`Task ended with ${status}`)
    },
  },
  // Default: writes agent stdout/stderr to .agent-runner/logs/<agent>.log
  // and tees the in-container output to your terminal.
  // Use logging: { type: "file", tee: false } for quiet file-only logging.
  // Use logging: { type: "stdout" } for terminal-only logging.
})

console.log(result)
```

OpenCode can be used with the same runner and Docker sandbox shape:

```ts
import { openCode } from "@alejandrocantero/agent-runner/agents/opencode"
import { runTask } from "@alejandrocantero/agent-runner"
import { dockerSandboxWithOpenCode } from "@alejandrocantero/agent-runner/sandboxes"

const result = await runTask({
  agent: openCode("anthropic/claude-sonnet-4-5", {
    agent: "build",
  }),
  sandbox: dockerSandboxWithOpenCode({
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
    },
  }),
  prompt: "Update the README",
  workspaceDir: "/path/to/workspace",
})
```

`result.logFilePath` contains the path to the log file when file logging is used.

By default, `runTask` appends a completion instruction to the prompt and waits for
`<promise>COMPLETE</promise>` in the agent output. Set `completionSignal` to use a
different marker. Set `completionPrompt` to customize the appended instruction, or
set `completionPrompt: false` to send the prompt exactly as provided.

Lifecycle hooks run in this order:

1. `sandbox-create`: before Docker starts.
2. `agent-start`: after Docker starts and before the first agent command.
3. `agent-finish`: after completion, max iterations, or failure, before Docker exits.
4. `sandbox-close`: after Docker closes.

Git helpers such as `createWorktree`, `deleteWorktree`, `commitAll`, and `mergeBranchIntoHead` are optional utilities. `commitAll` and `mergeBranchIntoHead` are hook factories; `createWorktree` and `deleteWorktree` are direct async functions for preparing and removing worktrees.

Run the included example:

```bash
npm run dev
```

## Release

Releases follow the same branch flow as `kanbamd`:

```bash
npm run release -- <major|minor|patch|fix|premajor|preminor|prepatch|prerelease>
```

The release script must run from `dev` with a clean working tree. It runs lint, typecheck, and tests, bumps `package.json`, builds, commits the version bump, pushes `dev`, fast-forwards `master`, and pushes `master`.

Publishing is handled by GitHub Actions on pushes to `master`. Configure the repository secret `NPM_TOKEN` with an npm token that can publish `@alejandrocantero/agent-runner`.
```
