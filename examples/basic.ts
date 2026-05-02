import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { claudeCode } from "../src/agents/index.js"
import { run } from "../src/index.js"
import { docker } from "../src/sandboxes/index.js"

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const claudeToken = process.env.CLAUDE_CODE_OAUTH_TOKEN

if (!claudeToken) {
  throw new Error("CLAUDE_CODE_OAUTH_TOKEN is required")
}

const result = await run({
  agent: claudeCode("claude-sonnet-4-6", {
    effort: "low",
  }),

  sandbox: docker({
    imageName: "mini-agent-runner:local",
    dockerfile: "Dockerfile",
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    },
  }),

  logging: {
    type: "stdout",
  },

  branch: "agent/demo",
  cwd: repoDir,
  prompt: "Actualiza el README y termina con <promise>COMPLETE</promise>",
  maxIterations: 3,
  idleTimeoutSeconds: 60 * 10,
})

console.log({
  branch: result.branch,
  worktreeDir: result.worktreeDir,
  iterations: result.iterations.length,
  completionSignal: result.completionSignal,
  commits: result.commits,
})
