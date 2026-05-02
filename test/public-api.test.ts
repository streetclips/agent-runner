import { describe, expect, test } from "vitest"
import { claudeCode } from "#src/agents/claude"
import { run } from "#src/run"
import { docker, dockerSandboxWithClaudeClode } from "#src/sandboxes/docker"

describe("public API", () => {
  test("exports the root run entrypoint", () => {
    expect(typeof run).toBe("function")
  })

  test("exports agent and sandbox factories", () => {
    const agent = claudeCode("claude-sonnet-4-6", { effort: "low" })
    const sandbox = docker({ imageName: "agent-runner:test" })

    expect(agent.name).toBe("claude-code")
    expect(agent.buildCommand({ prompt: "finish" }).command).toContain("claude")
    expect(sandbox.name).toBe("docker")
  })

  test("exports a default Claude Code docker sandbox", () => {
    const sandbox = dockerSandboxWithClaudeClode()

    expect(sandbox.name).toBe("docker")
  })

  test("rejects relative dockerfile paths", async () => {
    const sandbox = docker({
      imageName: "agent-runner:test",
      dockerfile: "Dockerfile",
    })

    await expect(
      sandbox.start({
        repoDir: "/tmp/repo",
        worktreeDir: "/tmp/worktree",
      }),
    ).rejects.toThrow("dockerfile must be an absolute path")
  })
})
