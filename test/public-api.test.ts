import { execFileSync } from "node:child_process"
import { access, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { claudeCode } from "../src/agents/claude.js"
import {
  openCode,
  parseStreamJsonLine as parseOpenCodeStreamJsonLine,
} from "../src/agents/opencode.js"
import {
  DEFAULT_COMPLETION_PROMPT,
  DEFAULT_COMPLETION_SIGNAL,
  commitAll,
  createWorktree,
  deleteWorktree,
  execInSandbox,
  runTask,
} from "../src/run.js"
import {
  docker,
  dockerSandboxWithClaudeCode,
  dockerSandboxWithOpenCode,
} from "../src/sandboxes/docker.js"
import type { Agent, ExecResult, RunTaskOptions, Sandbox, SandboxHandle } from "../src/types.js"

function fakeAgent(command = "agent-command"): Agent {
  return {
    name: "fake-agent",
    buildCommand() {
      return { command }
    },
  }
}

function promptCapturingAgent(input: { prompts: string[]; command?: string }): Agent {
  return {
    name: "fake-agent",
    buildCommand({ prompt }) {
      input.prompts.push(prompt)
      return { command: input.command ?? "agent-command" }
    },
  }
}

function execResult(input: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
    exitCode: input.exitCode ?? 0,
  }
}

function fakeSandbox(input?: {
  onStart?: () => void
  onClose?: () => void
  onExec?: (command: string) => ExecResult
}): Sandbox {
  return {
    name: "fake-sandbox",
    async start() {
      input?.onStart?.()

      return {
        async exec({ command }) {
          return input?.onExec?.(command) ?? execResult({ stdout: "<promise>COMPLETE</promise>" })
        },

        async close() {
          input?.onClose?.()
        },
      }
    },
  }
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" })
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function hookContext(workspaceDir: string, sandbox?: SandboxHandle) {
  return {
    workspaceDir,
    options: {} as RunTaskOptions,
    phase: "agent-finish" as const,
    sandbox,
    metadata: {},
  }
}

describe("public API", () => {
  test("exports the directory-based runTask entrypoint", () => {
    expect(typeof runTask).toBe("function")
  })

  test("exports agent and sandbox factories", () => {
    const agent = claudeCode("claude-sonnet-4-6", { effort: "low" })
    const opencodeAgent = openCode("anthropic/claude-sonnet-4-5")
    const sandbox = docker({ imageName: "agent-runner:test" })

    expect(agent.name).toBe("claude-code")
    expect(agent.buildCommand({ prompt: "finish" }).command).toContain("claude")
    expect(opencodeAgent.name).toBe("opencode")
    expect(opencodeAgent.buildCommand({ prompt: "finish" }).command).toContain("opencode")
    expect(sandbox.name).toBe("docker")
  })

  test("exports a default Claude Code docker sandbox", () => {
    const sandbox = dockerSandboxWithClaudeCode()

    expect(sandbox.name).toBe("docker")
  })

  test("exports a default OpenCode docker sandbox", () => {
    const sandbox = dockerSandboxWithOpenCode()

    expect(sandbox.name).toBe("docker")
  })

  test("builds an OpenCode run command", () => {
    const agent = openCode("anthropic/claude-sonnet-4-5")

    expect(agent.buildCommand({ prompt: "finish 'now'" }).command).toBe(
      "opencode run --model 'anthropic/claude-sonnet-4-5' --format json --dangerously-skip-permissions 'finish '\\''now'\\'''",
    )
  })

  test("builds an OpenCode command with optional agent and config", () => {
    const agent = openCode("anthropic/claude-sonnet-4-5", {
      agent: "build",
      title: "Agent task",
      config: "/tmp/opencode.json",
      configDir: "/tmp/opencode",
      configContent: '{"model":"anthropic/claude-sonnet-4-5"}',
      thinking: true,
    })

    expect(agent.buildCommand({ prompt: "finish" }).command).toBe(
      "OPENCODE_CONFIG='/tmp/opencode.json' OPENCODE_CONFIG_DIR='/tmp/opencode' OPENCODE_CONFIG_CONTENT='{\"model\":\"anthropic/claude-sonnet-4-5\"}' opencode run --model 'anthropic/claude-sonnet-4-5' --agent 'build' --title 'Agent task' --thinking --format json --dangerously-skip-permissions 'finish'",
    )
  })

  test("parses OpenCode text events", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "text",
          part: {
            text: "done",
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "done" }])
  })

  test("parses OpenCode reasoning events as visible text", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "reasoning",
          timestamp: 1767036064268,
          sessionID: "ses_123",
          part: {
            id: "prt_123",
            sessionID: "ses_123",
            messageID: "msg_123",
            type: "reasoning",
            text: "I should inspect the README first.",
          },
        }),
      ),
    ).toEqual([{ type: "text", text: "I should inspect the README first." }])
  })

  test("parses OpenCode session IDs", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "step_start",
          sessionID: "ses_123",
        }),
      ),
    ).toEqual([{ type: "session_id", sessionId: "ses_123" }])
  })

  test("parses OpenCode bash tool calls", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "tool_use",
          part: {
            tool: "bash",
            state: {
              input: {
                command: "npm test",
              },
            },
          },
        }),
      ),
    ).toEqual([{ type: "tool_call", name: "bash", args: "npm test" }])
  })

  test("parses OpenCode tool calls with JSON fallback args", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "tool_use",
          part: {
            tool: "custom",
            state: {
              input: {
                nested: true,
              },
            },
          },
        }),
      ),
    ).toEqual([{ type: "tool_call", name: "custom", args: '{"nested":true}' }])
  })

  test("ignores malformed OpenCode JSON lines", () => {
    expect(parseOpenCodeStreamJsonLine("{")).toEqual([])
  })

  test("parses final OpenCode step finish events", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "step_finish",
          timestamp: 1767036064273,
          sessionID: "ses_123",
          part: {
            id: "prt_123",
            sessionID: "ses_123",
            messageID: "msg_123",
            type: "step-finish",
            reason: "stop",
            cost: 0.001,
            tokens: {
              input: 671,
              output: 8,
              reasoning: 2,
              cache: {
                read: 10,
                write: 0,
              },
            },
          },
        }),
      ),
    ).toEqual([{ type: "result", result: "stop" }])
  })

  test("parses OpenCode error events", () => {
    expect(
      parseOpenCodeStreamJsonLine(
        JSON.stringify({
          type: "error",
          timestamp: 1767036065000,
          sessionID: "ses_123",
          error: {
            name: "APIError",
            data: {
              message: "Rate limit exceeded",
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "result",
        result: '{"name":"APIError","data":{"message":"Rate limit exceeded"}}',
      },
    ])
  })

  test("rejects relative dockerfile paths", async () => {
    const sandbox = docker({
      imageName: "agent-runner:test",
      dockerfile: "Dockerfile",
    })

    await expect(
      sandbox.start({
        workspaceDir: "/tmp/workspace",
      }),
    ).rejects.toThrow("dockerfile must be an absolute path")
  })

  test("runs a task in an arbitrary directory without git", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))

    const result = await runTask({
      agent: fakeAgent(),
      sandbox: fakeSandbox(),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
    })

    expect(result.workspaceDir).toBe(workspaceDir)
    expect(result.status).toBe("completed")
    expect(result.iterations).toHaveLength(1)
  })

  test("appends the default completion prompt to the agent prompt", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const prompts: string[] = []

    const result = await runTask({
      agent: promptCapturingAgent({ prompts }),
      sandbox: fakeSandbox(),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
    })

    expect(result.status).toBe("completed")
    expect(prompts).toEqual([
      `finish\n\n${DEFAULT_COMPLETION_PROMPT}\n${DEFAULT_COMPLETION_SIGNAL}`,
    ])
  })

  test("uses a custom completion signal for detection and the default completion prompt", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const prompts: string[] = []
    const completionSignal = "<promise>DONE</promise>"

    const result = await runTask({
      agent: promptCapturingAgent({ prompts }),
      sandbox: fakeSandbox({
        onExec: () => execResult({ stdout: completionSignal }),
      }),
      workspaceDir,
      prompt: "finish",
      completionSignal,
      logging: { type: "stdout" },
    })

    expect(result.status).toBe("completed")
    expect(result.completionSignal).toBe(completionSignal)
    expect(prompts).toEqual([`finish\n\n${DEFAULT_COMPLETION_PROMPT}\n${completionSignal}`])
  })

  test("appends a custom completion prompt verbatim", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const prompts: string[] = []
    const completionPrompt = "Say DONE when all work is finished."

    const result = await runTask({
      agent: promptCapturingAgent({ prompts }),
      sandbox: fakeSandbox(),
      workspaceDir,
      prompt: "finish",
      completionPrompt,
      logging: { type: "stdout" },
    })

    expect(result.status).toBe("completed")
    expect(prompts).toEqual([`finish\n\n${completionPrompt}`])
  })

  test("preserves the exact prompt when completion prompt is disabled", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const prompts: string[] = []

    const result = await runTask({
      agent: promptCapturingAgent({ prompts }),
      sandbox: fakeSandbox(),
      workspaceDir,
      prompt: "finish\n",
      completionPrompt: false,
      logging: { type: "stdout" },
    })

    expect(result.status).toBe("completed")
    expect(prompts).toEqual(["finish\n"])
  })

  test("runs lifecycle hooks in order", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const events: string[] = []

    await runTask({
      agent: fakeAgent(),
      sandbox: fakeSandbox({
        onStart: () => events.push("docker-start"),
        onClose: () => events.push("docker-close"),
      }),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
      hooks: {
        "sandbox-create": () => {
          events.push("sandbox-create")
        },
        "agent-start": () => {
          events.push("agent-start")
        },
        "agent-finish": () => {
          events.push("agent-finish")
        },
        "sandbox-close": () => {
          events.push("sandbox-close")
        },
      },
    })

    expect(events).toEqual([
      "sandbox-create",
      "docker-start",
      "agent-start",
      "agent-finish",
      "docker-close",
      "sandbox-close",
    ])
  })

  test("agent-start can run an in-container command", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const commands: string[] = []

    const result = await runTask({
      agent: fakeAgent("agent-command"),
      sandbox: fakeSandbox({
        onExec(command) {
          commands.push(command)
          return execResult({ stdout: "<promise>COMPLETE</promise>" })
        },
      }),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
      hooks: {
        "agent-start": execInSandbox("npm install"),
      },
    })

    expect(result.status).toBe("completed")
    expect(commands).toEqual(["npm install", "agent-command"])
  })

  test("runs finish and close hooks for failed tasks", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const events: string[] = []

    const result = await runTask({
      agent: fakeAgent(),
      sandbox: fakeSandbox({
        onClose: () => events.push("docker-close"),
        onExec: () => execResult({ stderr: "boom", exitCode: 1 }),
      }),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
      hooks: {
        "agent-finish": ({ status }) => {
          events.push(`agent-finish:${status}`)
        },
        "sandbox-close": ({ status }) => {
          events.push(`sandbox-close:${status}`)
        },
      },
    })

    expect(result.status).toBe("failed")
    expect(events).toEqual(["agent-finish:failed", "docker-close", "sandbox-close:failed"])
  })

  test("runs finish and close hooks for max iterations", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-workspace-"))
    const events: string[] = []

    const result = await runTask({
      agent: fakeAgent(),
      sandbox: fakeSandbox({
        onExec: () => execResult({ stdout: "not done" }),
      }),
      workspaceDir,
      prompt: "finish",
      logging: { type: "stdout" },
      maxIterations: 1,
      hooks: {
        "agent-finish": ({ status }) => {
          events.push(`agent-finish:${status}`)
        },
        "sandbox-close": ({ status }) => {
          events.push(`sandbox-close:${status}`)
        },
      },
    })

    expect(result.status).toBe("max_iterations")
    expect(events).toEqual(["agent-finish:max_iterations", "sandbox-close:max_iterations"])
  })

  test("commitAll commits all changes in a git workspace", async () => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "agent-runner-git-"))
    git(workspaceDir, ["init"])
    git(workspaceDir, ["config", "user.email", "agent-runner@example.com"])
    git(workspaceDir, ["config", "user.name", "Agent Runner"])

    await writeFile(path.join(workspaceDir, "README.md"), "hello\n")

    const metadata = await commitAll({ message: "commit changes" })(hookContext(workspaceDir))

    expect(metadata).toMatchObject({
      commits: [{ sha: expect.any(String) }],
      lastCommit: expect.any(String),
    })
  })

  test("deleteWorktree removes a registered git worktree", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "agent-runner-git-"))
    git(repoDir, ["init"])
    git(repoDir, ["config", "user.email", "agent-runner@example.com"])
    git(repoDir, ["config", "user.name", "Agent Runner"])
    await writeFile(path.join(repoDir, "README.md"), "hello\n")
    git(repoDir, ["add", "-A"])
    git(repoDir, ["commit", "-m", "initial"])

    const worktreeDir = path.join(repoDir, "worktrees", "agent-demo")
    git(repoDir, ["worktree", "add", "-B", "agent/demo", worktreeDir, "HEAD"])

    await deleteWorktree({ worktreeDir, force: true })

    expect(await pathExists(worktreeDir)).toBe(false)
    expect(gitOutput(repoDir, ["worktree", "list", "--porcelain"])).not.toContain(worktreeDir)
  })

  test("createWorktree creates a registered git worktree", async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), "agent-runner-git-"))
    git(repoDir, ["init"])
    git(repoDir, ["config", "user.email", "agent-runner@example.com"])
    git(repoDir, ["config", "user.name", "Agent Runner"])
    await writeFile(path.join(repoDir, "README.md"), "hello\n")
    git(repoDir, ["add", "-A"])
    git(repoDir, ["commit", "-m", "initial"])

    const worktreeDir = await createWorktree({ repoDir, branch: "agent/demo" })

    expect(await pathExists(worktreeDir)).toBe(true)
    expect(gitOutput(repoDir, ["worktree", "list", "--porcelain"])).toContain(worktreeDir)

    await deleteWorktree({ worktreeDir, force: true })
  })
})
