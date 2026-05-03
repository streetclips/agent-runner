import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { claudeCode } from "../src/agents/claude.js"
import { commitAll, createWorktree, deleteWorktree } from "../src/git.js"
import { DEFAULT_COMPLETION_SIGNAL, execInSandbox, runTask } from "../src/run.js"
import { dockerSandboxWithClaudeCode } from "../src/sandboxes/docker.js"

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const worktreePath = await createWorktree({ repoDir, branch: "agent/demo" })
const claudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN

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
  completionSignal: DEFAULT_COMPLETION_SIGNAL,
  prompt: `Actualiza el README y termina con ${DEFAULT_COMPLETION_SIGNAL}`,
  maxIterations: 3,
  idleTimeoutSeconds: 60 * 10,
  hooks: {
    "agent-start": execInSandbox("npm install"),
    "agent-finish": commitAll({ message: "Agent changes" }),
  },
})

console.log({
  workspaceDir: result.workspaceDir,
  status: result.status,
  iterations: result.iterations.length,
  completionSignal: result.completionSignal,
  metadata: result.metadata,
})

await deleteWorktree({ worktreeDir: worktreePath, force: true })
