import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { openCode } from "../src/agents/opencode.js"
import { commitAll, createWorktree, deleteWorktree, execInSandbox, runTask } from "../src/run.js"
import { dockerSandboxWithOpenCode } from "../src/sandboxes/docker.js"

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const worktreePath = await createWorktree({ repoDir, branch: "agent/opencode-demo" })
const ollamaApikey = process.env.OLLAMA_API_KEY

function formatError(error: unknown): string | undefined {
  if (error === undefined) {
    return undefined
  }

  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return String(error)
}

if (!ollamaApikey) {
  throw new Error("OLLAMA_API_KEY is required")
}

const result = await runTask({
  agent: openCode("ollama-cloud/deepseek-v4-pro", {
    agent: "build",
    thinking: true,
  }),
  sandbox: dockerSandboxWithOpenCode({
    env: {
      OLLAMA_API_KEY: ollamaApikey,
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
    "agent-finish": commitAll({ message: "[agent/opencode-demo] agent changes" }),
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
