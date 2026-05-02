import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { exec } from "#src/exec.js"
import type { Sandbox } from "#src/types.js"

const CLAUDE_CODE_DOCKERFILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dockerfiles/Dockerfile.claude-code",
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

    async start({ repoDir, worktreeDir }) {
      const dockerfile = options.dockerfile
      if (dockerfile !== undefined && !path.isAbsolute(dockerfile)) {
        throw new Error(`dockerfile must be an absolute path: ${dockerfile}`)
      }

      const context = options.context ?? "."
      const workdir = options.workdir ?? "/workspace"
      const containerName = `agent-runner-${randomUUID()}`

      const build = await exec(
        "docker",
        [
          "build",
          "-t",
          options.imageName,
          "-f",
          dockerfile ?? CLAUDE_CODE_DOCKERFILE,
          path.resolve(repoDir, context),
        ],
        {
          cwd: repoDir,
          onStdout: process.stdout.write.bind(process.stdout),
          onStderr: process.stderr.write.bind(process.stderr),
        },
      )

      if (build.exitCode !== 0) {
        throw new Error(`Docker build failed:\n${build.stderr}`)
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
          `${worktreeDir}:${workdir}`,
          "-w",
          workdir,
          "--entrypoint",
          "sleep",
          ...envArgs,
          options.imageName,
          "infinity",
        ],
        { cwd: repoDir },
      )

      if (run.exitCode !== 0) {
        throw new Error(`Docker run failed:\n${run.stderr}`)
      }

      return {
        async exec(input) {
          return exec("docker", ["exec", "-i", containerName, "sh", "-c", input.command], {
            cwd: repoDir,
            idleTimeoutMs: input.idleTimeoutMs,
            onStdout: input.onStdout,
            onStderr: input.onStderr,
          })
        },

        async close() {
          await exec("docker", ["rm", "-f", containerName], {
            cwd: repoDir,
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
