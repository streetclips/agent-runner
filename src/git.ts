import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { exec } from "./exec.js"
import type { TaskHook } from "./types.js"

export async function createWorktree(input: {
  repoDir: string
  branch: string
}): Promise<string> {
  const safeBranch = input.branch.replace(/[^a-zA-Z0-9._/-]/g, "-")

  const worktreePath = path.join(
    input.repoDir,
    ".agent-runner",
    "worktrees",
    safeBranch.replaceAll("/", "-"),
  )

  await mkdir(path.dirname(worktreePath), { recursive: true })
  const existingWorktreePath = await findWorktreeForBranch({
    repoDir: input.repoDir,
    branch: input.branch,
  })
  const pathToRemove = existingWorktreePath ?? worktreePath
  const remove = await exec("git", ["worktree", "remove", "--force", pathToRemove], {
    cwd: input.repoDir,
  })

  if (remove.exitCode !== 0 && !remove.stderr.includes("is not a working tree")) {
    throw new Error(remove.stderr)
  }

  await rm(worktreePath, { recursive: true, force: true })

  const result = await exec("git", ["worktree", "add", "-B", input.branch, worktreePath, "HEAD"], {
    cwd: input.repoDir,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr)
  }

  return worktreePath
}

async function findWorktreeForBranch(input: {
  repoDir: string
  branch: string
}): Promise<string | undefined> {
  const result = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: input.repoDir,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr)
  }

  const entries = result.stdout
    .trim()
    .split(/\n(?=worktree )/)
    .filter(Boolean)

  for (const entry of entries) {
    const worktree = entry.match(/^worktree (.+)$/m)?.[1]
    const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1]

    if (worktree && branch === input.branch) {
      return worktree
    }
  }

  return undefined
}

async function gitCommitAll(input: {
  workspaceDir: string
  message: string
}): Promise<{ sha?: string }> {
  await exec("git", ["add", "-A"], { cwd: input.workspaceDir })

  const diff = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: input.workspaceDir,
  })

  if (diff.exitCode === 0) {
    return {}
  }

  const commit = await exec("git", ["commit", "-m", input.message], {
    cwd: input.workspaceDir,
  })

  if (commit.exitCode !== 0) {
    throw new Error(commit.stderr)
  }

  const sha = await exec("git", ["rev-parse", "HEAD"], {
    cwd: input.workspaceDir,
  })

  if (sha.exitCode !== 0) {
    throw new Error(sha.stderr)
  }

  return {
    sha: sha.stdout.trim(),
  }
}

export function commitAll(input: { message: string }): TaskHook {
  return async (context) => {
    const commit = await gitCommitAll({
      workspaceDir: context.workspaceDir,
      message: input.message,
    })

    const commits = Array.isArray(context.metadata.commits) ? context.metadata.commits : []
    if (commit.sha) {
      commits.push({ sha: commit.sha })
    }
    context.metadata.commits = commits

    return {
      commits,
      lastCommit: commit.sha,
    }
  }
}

export async function deleteWorktree(input: {
  worktreeDir: string
  force?: boolean
}): Promise<void> {
  const gitCommonDir = await exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      cwd: input.worktreeDir,
    },
  )

  if (gitCommonDir.exitCode !== 0) {
    if (input.force) {
      await rm(input.worktreeDir, { recursive: true, force: true })
      return
    }

    throw new Error(gitCommonDir.stderr)
  }

  const repoDir = path.dirname(gitCommonDir.stdout.trim())
  const remove = await exec(
    "git",
    ["worktree", "remove", input.force ? "--force" : null, input.worktreeDir].filter(
      Boolean,
    ) as string[],
    { cwd: repoDir },
  )

  if (remove.exitCode !== 0) {
    if (input.force && remove.stderr.includes("is not a working tree")) {
      await rm(input.worktreeDir, { recursive: true, force: true })
      return
    }

    throw new Error(remove.stderr)
  }
}

export function mergeBranchIntoHead(input: {
  branch: string
  strategy?: "ff-only" | "no-ff"
}): TaskHook {
  return async (context) => {
    const strategy = input.strategy ?? "ff-only"
    const args =
      strategy === "ff-only"
        ? ["merge", "--ff-only", input.branch]
        : ["merge", "--no-ff", input.branch]

    const result = await exec("git", args, { cwd: context.workspaceDir })
    if (result.exitCode !== 0) {
      throw new Error(result.stderr)
    }
  }
}
