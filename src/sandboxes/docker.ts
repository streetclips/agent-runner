import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { exec } from "../exec.js"
import { style } from "../logger.js"
import type { Sandbox } from "../types.js"

const CLAUDE_CODE_DOCKERFILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dockerfiles/Dockerfile.claude-code",
)
const OPENCODE_DOCKERFILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dockerfiles/Dockerfile.opencode",
)

export function docker(options: {
  imageName: string
  dockerfile?: string
  context?: string
  workdir?: string
  env?: Record<string, string>
}): Sandbox {
  return {
    name: "docker",

    async start({ workspaceDir }) {
      const dockerfile = options.dockerfile
      if (dockerfile !== undefined && !path.isAbsolute(dockerfile)) {
        throw new Error(`dockerfile must be an absolute path: ${dockerfile}`)
      }

      const context = options.context ? path.resolve(workspaceDir, options.context) : workspaceDir
      const workdir = options.workdir ?? "/workspace"
      const containerName = `agent-runner-${randomUUID()}`

      const build = await exec(
        "docker",
        ["build", "-t", options.imageName, "-f", dockerfile ?? CLAUDE_CODE_DOCKERFILE, context],
        { cwd: workspaceDir },
      )

      if (build.exitCode !== 0) {
        process.stderr.write(style.dimError(build.stderr))
        throw new Error("Docker build failed")
      }

      const envArgs = Object.entries(options.env ?? {}).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
      ])

      const run = await exec(
        "docker",
        [
          "run",
          "-d",
          "--name",
          containerName,
          "-v",
          `${workspaceDir}:${workdir}`,
          "-w",
          workdir,
          "--entrypoint",
          "sleep",
          ...envArgs,
          options.imageName,
          "infinity",
        ],
        { cwd: workspaceDir },
      )

      if (run.exitCode !== 0) {
        throw new Error(`Docker run failed:\n${run.stderr}`)
      }

      return {
        async exec(input) {
          return exec("docker", ["exec", "-i", containerName, "sh", "-c", input.command], {
            cwd: workspaceDir,
            idleTimeoutMs: input.idleTimeoutMs,
            onStdout: input.onStdout,
            onStderr: input.onStderr,
          })
        },

        async close() {
          await exec("docker", ["rm", "-f", containerName], {
            cwd: workspaceDir,
          })
        },
      }
    },
  }
}

export function dockerSandboxWithClaudeCode(options?: {
  imageName?: string
  context?: string
  workdir?: string
  env?: Record<string, string>
}): Sandbox {
  return docker({
    imageName: options?.imageName ?? "agent-runner-claude-code:local",
    dockerfile: CLAUDE_CODE_DOCKERFILE,
    context: options?.context,
    workdir: options?.workdir,
    env: options?.env,
  })
}

export function dockerSandboxWithOpenCode(options?: {
  imageName?: string
  context?: string
  workdir?: string
  env?: Record<string, string>
}): Sandbox {
  return docker({
    imageName: options?.imageName ?? "agent-runner-opencode:local",
    dockerfile: OPENCODE_DOCKERFILE,
    context: options?.context,
    workdir: options?.workdir,
    env: options?.env,
  })
}
