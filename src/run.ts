import path from "node:path"
import { FileLogger } from "./file-logger.js"
import { commitAll, createWorktree } from "./git.js"
import type { IterationResult, ParsedStreamEvent, RunOptions, RunResult, Sandbox } from "./types.js"

export const DEFAULT_COMPLETION_SIGNAL = "<promise>COMPLETE</promise>"

function sanitizeBranchForFilename(branch: string): string {
  return branch.replace(/[/\\:*?"<>|]/g, "-")
}

function defaultLogPath(input: {
  repoDir: string
  branch: string
  agentName: string
}): string {
  return path.join(
    input.repoDir,
    ".agent-runner",
    "logs",
    `${sanitizeBranchForFilename(input.branch)}-${input.agentName}.log`,
  )
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`
}

function renderStreamEvent(event: ParsedStreamEvent): string | undefined {
  switch (event.type) {
    case "text":
      return ensureTrailingNewline(event.text)
    case "tool_call":
      return `[tool] ${event.name}: ${event.args}\n`
    case "session_id":
      return `[session] ${event.sessionId}\n`
    case "result":
      return undefined
  }
}

export async function run(options: RunOptions): Promise<RunResult> {
  const repoDir = path.resolve(options.cwd ?? process.cwd())
  const maxIterations = options.maxIterations ?? 1
  const idleTimeoutMs = (options.idleTimeoutSeconds ?? 600) * 1000
  const logging = options.logging ?? {
    type: "file" as const,
    path: defaultLogPath({
      repoDir,
      branch: options.branch,
      agentName: options.agent.name,
    }),
    tee: true,
  }
  const teeToConsole = logging.type === "stdout" || logging.tee !== false

  const completionSignals = Array.isArray(options.completionSignal)
    ? options.completionSignal
    : [options.completionSignal ?? DEFAULT_COMPLETION_SIGNAL]

  const logger =
    logging.type === "file"
      ? await FileLogger.create(
          path.resolve(
            repoDir,
            logging.path ??
              defaultLogPath({
                repoDir,
                branch: options.branch,
                agentName: options.agent.name,
              }),
          ),
        )
      : undefined

  if (logger) {
    console.log(`[run] logging agent output to ${logger.path}`)
    logger.line(`Agent: ${options.agent.name}`)
    logger.line(`Sandbox: ${options.sandbox.name}`)
    logger.line(`Branch: ${options.branch}`)
    logger.line(`Max iterations: ${maxIterations}`)
  }

  const iterations: IterationResult[] = []
  const commits: { sha: string }[] = []
  let allStdout = ""
  let matchedCompletionSignal: string | undefined
  let sandbox: Awaited<ReturnType<Sandbox["start"]>> | undefined
  let worktreeDir = ""

  try {
    worktreeDir = await createWorktree({
      repoDir,
      branch: options.branch,
    })

    sandbox = await options.sandbox.start({
      repoDir,
      worktreeDir,
    })

    for (let i = 1; i <= maxIterations; i++) {
      const iterationMessage = `[run] iteration ${i}/${maxIterations}`
      console.log(iterationMessage)
      logger?.line(iterationMessage)

      const agentCommand = options.agent.buildCommand({
        prompt: options.prompt,
      })
      const parsedEvents: ParsedStreamEvent[] = []
      let stdoutLineBuffer = ""

      const parseStdoutLine = (line: string) => {
        for (const event of options.agent.parseStreamLine?.(line) ?? []) {
          parsedEvents.push(event)
          options.onStep?.(event, { iteration: i })

          if (teeToConsole) {
            const rendered = renderStreamEvent(event)
            if (rendered) {
              process.stdout.write(rendered)
            }
          }
        }
      }
      const printRawStdout = teeToConsole && !options.agent.parseStreamLine

      const result = await sandbox.exec({
        command: agentCommand.command,
        idleTimeoutMs,
        onStdout(chunk) {
          if (printRawStdout) {
            process.stdout.write(chunk)
          }
          logger?.write(chunk)

          if (options.agent.parseStreamLine) {
            stdoutLineBuffer += chunk
            const lines = stdoutLineBuffer.split("\n")
            stdoutLineBuffer = lines.pop() ?? ""

            for (const line of lines) {
              parseStdoutLine(line)
            }
          }
        },
        onStderr(chunk) {
          if (teeToConsole) {
            process.stderr.write(chunk)
          }
          logger?.write(chunk)
        },
      })

      if (stdoutLineBuffer.length > 0) {
        parseStdoutLine(stdoutLineBuffer)
      }

      if (result.exitCode !== 0) {
        logger?.line(`[run] agent failed with exit code ${result.exitCode}`)
        throw new Error(`Agent failed with exit code ${result.exitCode}:\n${result.stderr}`)
      }

      const completionSignal = completionSignals.find((signal) => result.stdout.includes(signal))

      iterations.push({
        index: i,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        parsedEvents,
        completionSignal,
      })

      allStdout += result.stdout

      const commit = await commitAll({
        cwd: worktreeDir,
        message: `[${options.branch}] Agent iteration ${i}`,
      })

      if (commit.sha) {
        commits.push({ sha: commit.sha })
        logger?.line(`[run] committed ${commit.sha}`)
      }

      if (completionSignal) {
        matchedCompletionSignal = completionSignal
        const completionMessage = `[run] completion signal matched: ${completionSignal}`
        console.log(completionMessage)
        logger?.line(completionMessage)
        break
      }
    }

    return {
      branch: options.branch,
      worktreeDir,
      iterations,
      stdout: allStdout,
      completionSignal: matchedCompletionSignal,
      commits,
      logFilePath: logger?.path,
    }
  } finally {
    try {
      await sandbox?.close()
    } finally {
      await logger?.close()
    }
  }
}
