import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { claudeCode } from "../src/agents/claude.js"
import { commitAll, createWorktree, deleteWorktree, execInSandbox, runTask } from "../src/run.js"
import { dockerSandboxWithClaudeCode } from "../src/sandboxes/docker.js"

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const worktreePath = await createWorktree({ repoDir, branch: "agent/demo" })
const claudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN

function formatError(error: unknown): string | undefined {
  if (error === undefined) {
    return undefined
  }

  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return String(error)
}

if (!claudeToken) {
  throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required")
}

const result = await runTask({
  agent: claudeCode("claude-sonnet-4-6", {
    effort: "low",
  }),
  sandbox: dockerSandboxWithClaudeCode({
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    },
  }),
  logging: {
    type: "stdout",
  },
  workspaceDir: worktreePath,
  prompt: "Update README.md",
  maxIterations: 3,
  idleTimeoutSeconds: 60 * 10,
  hooks: {
    "agent-start": execInSandbox("npm install"),
    "agent-finish": commitAll({ message: "[agent/demo] agent changes" }),
  },
})

console.log({
  workspaceDir: result.workspaceDir,
  status: result.status,
  iterations: result.iterations.length,
  completionSignal: result.completionSignal,
  error: formatError(result.error),
  metadata: result.metadata,
})

if (result.status !== "completed") {
  throw new Error(`Agent task failed; preserving worktree at ${worktreePath}`)
}

await deleteWorktree({ worktreeDir: worktreePath, force: true })
