import { spawn } from "node:child_process"
import type { ExecResult } from "#src/types.js"

export type { ExecResult } from "#src/types.js"

export function exec(
  command: string,
  args: string[],
  options?: {
    cwd?: string
    stdin?: string
    env?: NodeJS.ProcessEnv
    idleTimeoutMs?: number
    onStdout?: (chunk: string) => void
    onStderr?: (chunk: string) => void
  },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let idleTimer: NodeJS.Timeout | undefined
    let settled = false

    const cleanupIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = undefined
      }
    }

    const fail = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanupIdleTimer()
      child.kill("SIGTERM")
      reject(error)
    }

    const resetIdleTimer = () => {
      if (!options?.idleTimeoutMs) {
        return
      }

      cleanupIdleTimer()

      idleTimer = setTimeout(() => {
        fail(
          new Error(
            `Command was idle for ${options.idleTimeoutMs}ms: ${command} ${args.join(" ")}`,
          ),
        )
      }, options.idleTimeoutMs)
    }

    resetIdleTimer()

    child.stdout.on("data", (buffer: Buffer) => {
      resetIdleTimer()
      const chunk = buffer.toString()
      stdout += chunk
      options?.onStdout?.(chunk)
    })

    child.stderr.on("data", (buffer: Buffer) => {
      resetIdleTimer()
      const chunk = buffer.toString()
      stderr += chunk
      options?.onStderr?.(chunk)
    })

    child.on("error", fail)

    child.on("close", (code) => {
      if (settled) {
        return
      }
      settled = true
      cleanupIdleTimer()

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })

    if (options?.stdin !== undefined) {
      child.stdin.write(options.stdin)
    }

    child.stdin.end()
  })
}
