import path from "node:path"
import { FileLogger } from "./file-logger.js"
import { info, log, step, style, success } from "./logger.js"
import type {
  ExecResult,
  IterationResult,
  ParsedStreamEvent,
  RunTaskOptions,
  RunTaskResult,
  Sandbox,
  TaskHook,
  TaskHookContext,
  TaskHookPhase,
  TaskMetadata,
  TaskStatus,
} from "./types.js"
export { commitAll, createWorktree, deleteWorktree, mergeBranchIntoHead } from "./git.js"

export const DEFAULT_COMPLETION_SIGNAL = "<promise>COMPLETE</promise>"
export const DEFAULT_COMPLETION_PROMPT =
  "When the task is complete, output the completion signal exactly as written:"

function defaultLogPath(input: {
  workspaceDir: string
  agentName: string
}): string {
  return path.join(input.workspaceDir, ".agent-runner", "logs", `${input.agentName}.log`)
}

function buildPrompt(input: { prompt: string; completionPrompt?: string | false }): string {
  if (input.completionPrompt === false) {
    return input.prompt
  }

  const completionPrompt = input.completionPrompt ?? DEFAULT_COMPLETION_PROMPT

  return `${input.prompt.trimEnd()}\n\n${completionPrompt}`
}

function normalizeHooks(hookOrHooks: TaskHook | TaskHook[] | undefined): TaskHook[] {
  if (hookOrHooks === undefined) {
    return []
  }

  return Array.isArray(hookOrHooks) ? hookOrHooks : [hookOrHooks]
}

function mergeMetadata(metadata: TaskMetadata, update: unknown): void {
  if (
    update === undefined ||
    update === null ||
    typeof update !== "object" ||
    Array.isArray(update)
  ) {
    return
  }

  Object.assign(metadata, update as TaskMetadata)
}

async function runHooks(input: {
  phase: TaskHookPhase
  options: RunTaskOptions
  workspaceDir: string
  sandbox?: Awaited<ReturnType<Sandbox["start"]>>
  result?: RunTaskResult
  status?: TaskStatus
  error?: unknown
  metadata: TaskMetadata
}): Promise<unknown[]> {
  const errors: unknown[] = []

  for (const hook of normalizeHooks(input.options.hooks?.[input.phase])) {
    const context: TaskHookContext = {
      workspaceDir: input.workspaceDir,
      options: input.options,
      phase: input.phase,
      sandbox: input.sandbox,
      result: input.result,
      status: input.status,
      error: input.error,
      metadata: input.metadata,
    }

    try {
      mergeMetadata(input.metadata, await hook(context))
    } catch (error) {
      errors.push(error)
    }
  }

  return errors
}

function combineErrors(errors: unknown[]): unknown {
  if (errors.length === 0) {
    return undefined
  }

  if (errors.length === 1) {
    return errors[0]
  }

  return new AggregateError(errors, "Multiple task errors occurred")
}

export function execInSandbox(command: string): TaskHook {
  return async (context) => {
    if (!context.sandbox) {
      throw new Error("execInSandbox requires a running sandbox")
    }

    const result: ExecResult = await context.sandbox.exec({ command })
    if (result.exitCode !== 0) {
      throw new Error(`Sandbox command failed with exit code ${result.exitCode}:\n${result.stderr}`)
    }

    return {
      lastSandboxExec: result,
    }
  }
}

export async function runTask(options: RunTaskOptions): Promise<RunTaskResult> {
  const workspaceDir = path.resolve(options.workspaceDir)
  const maxIterations = options.maxIterations ?? 1
  const idleTimeoutMs = (options.idleTimeoutSeconds ?? 600) * 1000
  const logging = options.logging ?? {
    type: "file" as const,
    path: defaultLogPath({
      workspaceDir,
      agentName: options.agent.name,
    }),
    tee: true,
  }
  const teeToConsole = logging.type === "stdout" || logging.tee !== false

  const completionSignals = Array.isArray(options.completionSignal)
    ? options.completionSignal
    : [options.completionSignal ?? DEFAULT_COMPLETION_SIGNAL]
  const completionPrompt =
    options.completionPrompt === undefined
      ? `${DEFAULT_COMPLETION_PROMPT}\n${completionSignals[0] ?? DEFAULT_COMPLETION_SIGNAL}`
      : options.completionPrompt
  const prompt = buildPrompt({
    prompt: options.prompt,
    completionPrompt,
  })

  const logger =
    logging.type === "file"
      ? await FileLogger.create(
          path.resolve(
            workspaceDir,
            logging.path ??
              defaultLogPath({
                workspaceDir,
                agentName: options.agent.name,
              }),
          ),
        )
      : undefined

  if (logger) {
    info(`logging agent output to ${logger.path}`)
    logger.line(`Agent: ${options.agent.name}`)
    logger.line(`Sandbox: ${options.sandbox.name}`)
    logger.line(`Workspace: ${workspaceDir}`)
    logger.line(`Max iterations: ${maxIterations}`)
  }

  const iterations: IterationResult[] = []
  const metadata: TaskMetadata = {}
  const errors: unknown[] = []
  let allStdout = ""
  let matchedCompletionSignal: string | undefined
  let sandbox: Awaited<ReturnType<Sandbox["start"]>> | undefined
  let status: TaskStatus = "max_iterations"
  let primaryError: unknown

  try {
    const sandboxCreateErrors = await runHooks({
      phase: "sandbox-create",
      options,
      workspaceDir,
      metadata,
    })
    if (sandboxCreateErrors.length > 0) {
      throw combineErrors(sandboxCreateErrors)
    }

    sandbox = await options.sandbox.start({
      workspaceDir,
    })

    const agentStartErrors = await runHooks({
      phase: "agent-start",
      options,
      workspaceDir,
      sandbox,
      metadata,
    })
    if (agentStartErrors.length > 0) {
      throw combineErrors(agentStartErrors)
    }

    for (let i = 1; i <= maxIterations; i++) {
      step(`iteration ${i}/${maxIterations}`)
      logger?.line(`[run] iteration ${i}/${maxIterations}`)

      const agentCommand = options.agent.buildCommand({
        prompt,
      })
      const parsedEvents: ParsedStreamEvent[] = []
      let stdoutLineBuffer = ""

      const parseStdoutLine = (line: string) => {
        for (const event of options.agent.parseStreamLine?.(line) ?? []) {
          parsedEvents.push(event)
          options.onStep?.(event, { iteration: i })

          if (teeToConsole) {
            switch (event.type) {
              case "text":
                log("agent", event.text.trimEnd(), style.dim, "○")
                break
              case "tool_call":
                log("agent", `${style.tool("[tool]")} ${event.name}: ${event.args}`, undefined, "○")
                break
              case "session_id":
                log("agent", event.sessionId, style.dim, "○")
                break
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

      if (completionSignal) {
        matchedCompletionSignal = completionSignal
        status = "completed"
        success(`completion signal matched: ${completionSignal}`)
        logger?.line(`[run] completion signal matched: ${completionSignal}`)
        break
      }
    }
  } catch (error) {
    status = "failed"
    primaryError = error
    errors.push(error)
  }

  const result: RunTaskResult = {
    workspaceDir,
    iterations,
    stdout: allStdout,
    status,
    completionSignal: matchedCompletionSignal,
    error: primaryError,
    metadata,
    logFilePath: logger?.path,
  }

  errors.push(
    ...(await runHooks({
      phase: "agent-finish",
      options,
      workspaceDir,
      sandbox,
      result,
      status,
      error: primaryError,
      metadata,
    })),
  )

  try {
    await sandbox?.close()
  } catch (error) {
    status = "failed"
    primaryError ??= error
    errors.push(error)
  }

  result.status = status
  result.error = primaryError

  errors.push(
    ...(await runHooks({
      phase: "sandbox-close",
      options,
      workspaceDir,
      sandbox,
      result,
      status,
      error: primaryError,
      metadata,
    })),
  )

  const finalError = combineErrors(errors)
  if (finalError !== undefined) {
    result.status = "failed"
    result.error = finalError
  }

  await logger?.close()
  return result
}
