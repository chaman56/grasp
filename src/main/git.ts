import { execFile } from 'node:child_process'
import type { GitInfo, Mode } from '../shared/types'

const MAX_OUTPUT = 256 * 1024 * 1024

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd: root, maxBuffer: MAX_OUTPUT, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message))
        else resolve(stdout)
      },
    )
  })
}

async function tryGit(root: string, args: string[]): Promise<string | null> {
  return (await tryGitRaw(root, args))?.trim() ?? null
}

export async function isGitRepo(root: string): Promise<boolean> {
  return (await tryGit(root, ['rev-parse', '--show-toplevel'])) !== null
}

async function defaultBranch(root: string): Promise<string | null> {
  const remoteHead = await tryGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remoteHead) return remoteHead
  for (const candidate of ['main', 'master', 'origin/main', 'origin/master']) {
    if (await tryGit(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])) return candidate
  }
  return null
}

/** Resolves what the diff is taken against. Branch mode on the default branch itself falls back to HEAD. */
export async function gitInfo(root: string, mode: Mode): Promise<GitInfo> {
  const branch = (await tryGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) ?? 'detached HEAD'
  const head = await tryGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  if (!head) return { branch, base: null, baseLabel: 'no commits yet' }
  if (mode === 'branch') {
    const target = await defaultBranch(root)
    const base = target ? await tryGit(root, ['merge-base', 'HEAD', target]) : null
    if (target && base && base !== head) return { branch, base, baseLabel: `vs ${target}` }
  }
  return { branch, base: head, baseLabel: mode === 'branch' ? 'on default branch · uncommitted only' : 'uncommitted' }
}

/** Diff of the working tree (including staged and unstaged changes) against `base`. */
export function diffAgainst(root: string, base: string, context: number, paths: string[] = []): Promise<string> {
  return git(root, ['diff', '--no-color', '--no-ext-diff', '--relative', '-M', `-U${context}`, base, '--', ...paths])
}

export async function untrackedFiles(root: string): Promise<string[]> {
  return splitZ(await git(root, ['ls-files', '-z', '--others', '--exclude-standard']))
}

export async function listFiles(root: string): Promise<string[]> {
  return splitZ(await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
}

function splitZ(output: string): string[] {
  return output.split('\0').filter(Boolean)
}

/** File content at `base`, or null when it didn't exist there. `./` makes the path relative to `root`. */
export function showAtBase(root: string, base: string, path: string): Promise<string | null> {
  return tryGitRaw(root, ['show', `${base}:./${path}`])
}

async function tryGitRaw(root: string, args: string[]): Promise<string | null> {
  try {
    return await git(root, args)
  } catch {
    return null
  }
}
