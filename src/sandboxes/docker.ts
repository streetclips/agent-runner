import { randomUUID } from "node:crypto";
import path from "node:path";
import { exec, type ExecResult } from "../exec.js";

export interface Sandbox {
  name: string;

  start(input: { repoDir: string; worktreeDir: string }): Promise<SandboxHandle>;
}

export interface SandboxHandle {
  exec(input: {
    command: string;
    stdin?: string;
    idleTimeoutMs?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }): Promise<ExecResult>;

  close(): Promise<void>;
}

export function docker(options: {
  imageName: string;
  dockerfile?: string;
  context?: string;
  workdir?: string;
  env?: Record<string, string>;
}): Sandbox {
  return {
    name: "docker",

    async start({ repoDir, worktreeDir }) {
      const dockerfile = options.dockerfile ?? "Dockerfile";
      const context = options.context ?? ".";
      const workdir = options.workdir ?? "/workspace";
      const containerName = `mini-agent-${randomUUID()}`;

      const build = await exec(
        "docker",
        [
          "build",
          "-t",
          options.imageName,
          "-f",
          path.resolve(repoDir, dockerfile),
          path.resolve(repoDir, context),
        ],
        {
          cwd: repoDir,
          onStdout: process.stdout.write.bind(process.stdout),
          onStderr: process.stderr.write.bind(process.stderr),
        },
      );

      if (build.exitCode !== 0) {
        throw new Error(`Docker build failed:\n${build.stderr}`);
      }

      const envArgs = Object.entries(options.env ?? {}).flatMap(([key, value]) => [
        "-e",
        `${key}=${value}`,
      ]);

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
          ...envArgs,
          options.imageName,
          "sleep",
          "infinity",
        ],
        { cwd: repoDir },
      );

      if (run.exitCode !== 0) {
        throw new Error(`Docker run failed:\n${run.stderr}`);
      }

      return {
        async exec(input) {
          return exec(
            "docker",
            ["exec", "-i", containerName, "sh", "-lc", input.command],
            {
              cwd: repoDir,
              stdin: input.stdin,
              idleTimeoutMs: input.idleTimeoutMs,
              onStdout: input.onStdout,
              onStderr: input.onStderr,
            },
          );
        },

        async close() {
          await exec("docker", ["rm", "-f", containerName], {
            cwd: repoDir,
          });
        },
      };
    },
  };
}
