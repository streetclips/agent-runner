import path from "node:path";
import type { Agent } from "./agent.js";
import { commitAll, createWorktree } from "./git.js";
import type { Sandbox } from "./sandboxes/docker.js";

export const DEFAULT_COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

export interface RunOptions {
  agent: Agent;
  sandbox: Sandbox;
  prompt: string;
  branch: string;
  cwd?: string;
  maxIterations?: number;
  completionSignal?: string | string[];
  idleTimeoutSeconds?: number;
}

export interface IterationResult {
  index: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  completionSignal?: string;
}

export interface RunResult {
  branch: string;
  worktreeDir: string;
  iterations: IterationResult[];
  stdout: string;
  completionSignal?: string;
  commits: { sha: string }[];
}

export async function run(options: RunOptions): Promise<RunResult> {
  const repoDir = path.resolve(options.cwd ?? process.cwd());
  const maxIterations = options.maxIterations ?? 1;
  const idleTimeoutMs = (options.idleTimeoutSeconds ?? 600) * 1000;

  const completionSignals = Array.isArray(options.completionSignal)
    ? options.completionSignal
    : [options.completionSignal ?? DEFAULT_COMPLETION_SIGNAL];

  const worktreeDir = await createWorktree({
    repoDir,
    branch: options.branch,
  });

  const sandbox = await options.sandbox.start({
    repoDir,
    worktreeDir,
  });

  const iterations: IterationResult[] = [];
  const commits: { sha: string }[] = [];
  let allStdout = "";
  let matchedCompletionSignal: string | undefined;

  try {
    for (let i = 1; i <= maxIterations; i++) {
      console.log(`[run] iteration ${i}/${maxIterations}`);

      const agentCommand = options.agent.buildCommand({
        prompt: options.prompt,
      });

      const result = await sandbox.exec({
        command: agentCommand.command,
        stdin: agentCommand.stdin,
        idleTimeoutMs,
        onStdout(chunk) {
          process.stdout.write(chunk);
        },
        onStderr(chunk) {
          process.stderr.write(chunk);
        },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Agent failed with exit code ${result.exitCode}:\n${result.stderr}`,
        );
      }

      const completionSignal = completionSignals.find((signal) =>
        result.stdout.includes(signal),
      );

      iterations.push({
        index: i,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        completionSignal,
      });

      allStdout += result.stdout;

      const commit = await commitAll({
        cwd: worktreeDir,
        message: `Agent iteration ${i}`,
      });

      if (commit.sha) {
        commits.push({ sha: commit.sha });
      }

      if (completionSignal) {
        matchedCompletionSignal = completionSignal;
        console.log(`[run] completion signal matched: ${completionSignal}`);
        break;
      }
    }

    return {
      branch: options.branch,
      worktreeDir,
      iterations,
      stdout: allStdout,
      completionSignal: matchedCompletionSignal,
      commits,
    };
  } finally {
    await sandbox.close();
  }
}
