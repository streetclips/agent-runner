import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { exec } from "./exec.js";

export async function currentBranch(cwd: string): Promise<string> {
  const result = await exec("git", ["branch", "--show-current"], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }

  return result.stdout.trim();
}

export async function createWorktree(input: {
  repoDir: string;
  branch: string;
}): Promise<string> {
  const safeBranch = input.branch.replace(/[^a-zA-Z0-9._/-]/g, "-");

  const worktreePath = path.join(
    input.repoDir,
    ".mini-agent",
    "worktrees",
    safeBranch.replaceAll("/", "-"),
  );

  await mkdir(path.dirname(worktreePath), { recursive: true });
  await rm(worktreePath, { recursive: true, force: true });

  const result = await exec(
    "git",
    ["worktree", "add", "-B", input.branch, worktreePath, "HEAD"],
    { cwd: input.repoDir },
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr);
  }

  return worktreePath;
}

export async function commitAll(input: {
  cwd: string;
  message: string;
}): Promise<{ sha?: string }> {
  await exec("git", ["add", "-A"], { cwd: input.cwd });

  const diff = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: input.cwd,
  });

  if (diff.exitCode === 0) {
    return {};
  }

  const commit = await exec("git", ["commit", "-m", input.message], {
    cwd: input.cwd,
  });

  if (commit.exitCode !== 0) {
    throw new Error(commit.stderr);
  }

  const sha = await exec("git", ["rev-parse", "HEAD"], {
    cwd: input.cwd,
  });

  if (sha.exitCode !== 0) {
    throw new Error(sha.stderr);
  }

  return {
    sha: sha.stdout.trim(),
  };
}
