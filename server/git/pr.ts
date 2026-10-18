import { git, run, HttpError } from '../util.ts'

/** What the PR view shows: read-only, from the host's own CLI (gh, glab or az). */
export type PullRequest = {
  provider: Provider
  number: number
  title: string
  body: string
  state: string
  url: string
  isDraft: boolean
  author?: { login: string }
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision?: string
  createdAt: string
  updatedAt: string
  reviews: { author?: { login: string }; state: string; body: string; submittedAt: string }[]
  comments: { author?: { login: string }; body: string; createdAt: string }[]
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string; detailsUrl?: string; targetUrl?: string }[]
}

export type PrListItem = { number: number; title: string; headRefName: string; author?: { login: string }; updatedAt: string; isDraft: boolean }

export type Provider = 'github' | 'gitlab' | 'azure'

/** Which host the repo's origin points at; GitHub when unsure (gh also reads GitHub Enterprise). */
export function providerOf(remoteUrl: string): Provider {
  const u = remoteUrl.toLowerCase()
  if (/dev\.azure\.com|\.visualstudio\.com|ssh\.dev\.azure\.com/.test(u)) return 'azure'
  if (/gitlab/.test(u)) return 'gitlab'
  return 'github'
}

const CLI: Record<Provider, { bin: string; install: string }> = {
  github: { bin: 'gh', install: '`brew install gh` 후 `gh auth login`' },
  gitlab: { bin: 'glab', install: '`brew install glab` 후 `glab auth login`' },
  azure: { bin: 'az', install: '`brew install azure-cli`, `az extension add --name azure-devops` 후 `az login`' },
}

async function cli(provider: Provider, root: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const res = await run(CLI[provider].bin, args, { cwd: root, timeout: 25_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GLAB_NO_PROMPT: '1' } })
  return { ok: res.code === 0, out: res.stdout, err: res.stderr }
}

function explain(provider: Provider, err: string): string {
  const { bin, install } = CLI[provider]
  if (/ENOENT|not found|command not found|spawn/i.test(err)) return `${bin} CLI가 없어서 PR을 못 읽어. 설치: ${install}`
  if (/auth|login|credential|unauthori[sz]ed/i.test(err)) return `${bin} 로그인이 필요해. 터미널에서: ${install.split(' 후 ').pop()}`
  return err.trim().split('\n')[0].slice(0, 200) || 'PR 정보를 읽지 못했어'
}

const NONE = /no pull requests found|could not find any pull requests|no open merge request|no merge request|not found for branch|404/i

async function originUrl(root: string): Promise<string> {
  return (await git(root, ['remote', 'get-url', 'origin'], { allowFail: true })).trim()
}

const providers = new Map<string, Provider>()
async function providerFor(root: string): Promise<Provider> {
  let p = providers.get(root)
  if (!p) { p = providerOf(await originUrl(root)); providers.set(root, p) }
  return p
}

// ---------------------------------------------------------------- GitHub (gh)

const GH_FIELDS = 'number,title,body,state,url,isDraft,author,baseRefName,headRefName,baseRefOid,headRefOid,additions,deletions,changedFiles,reviewDecision,createdAt,updatedAt,reviews,comments,statusCheckRollup'

// ---------------------------------------------------------------- GitLab (glab, REST shapes)

type GitlabMr = {
  iid: number; title: string; description?: string; state: string; web_url: string; draft?: boolean; work_in_progress?: boolean
  author?: { username?: string }; target_branch: string; source_branch: string; sha?: string
  diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string }
  created_at: string; updated_at: string; changes_count?: string
  head_pipeline?: { status?: string; web_url?: string; name?: string } | null
}
type GitlabNote = { body: string; author?: { username?: string }; created_at: string; system?: boolean }

export function normalizeGitlab(mr: GitlabMr, notes: GitlabNote[] = []): PullRequest {
  const pipe = mr.head_pipeline
  return {
    provider: 'gitlab',
    number: mr.iid,
    title: mr.title,
    body: mr.description ?? '',
    state: mr.state === 'opened' ? 'OPEN' : mr.state === 'merged' ? 'MERGED' : 'CLOSED',
    url: mr.web_url,
    isDraft: Boolean(mr.draft ?? mr.work_in_progress),
    author: mr.author?.username ? { login: mr.author.username } : undefined,
    baseRefName: mr.target_branch,
    headRefName: mr.source_branch,
    baseRefOid: mr.diff_refs?.base_sha ?? '',
    headRefOid: mr.diff_refs?.head_sha ?? mr.sha ?? '',
    additions: 0,
    deletions: 0,
    changedFiles: Number(mr.changes_count ?? 0) || 0,
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    reviews: [],
    comments: notes.filter(n => !n.system).map(n => ({ author: n.author?.username ? { login: n.author.username } : undefined, body: n.body, createdAt: n.created_at })),
    statusCheckRollup: pipe ? [{ name: pipe.name ?? 'pipeline', status: pipe.status, conclusion: pipe.status === 'success' ? 'SUCCESS' : pipe.status === 'failed' ? 'FAILURE' : undefined, detailsUrl: pipe.web_url }] : [],
  }
}

// ---------------------------------------------------------------- Azure DevOps (az repos)

type AzurePr = {
  pullRequestId: number; title: string; description?: string; status: string; isDraft?: boolean
  createdBy?: { displayName?: string; uniqueName?: string }; creationDate: string; closedDate?: string
  sourceRefName: string; targetRefName: string
  lastMergeSourceCommit?: { commitId?: string }; lastMergeTargetCommit?: { commitId?: string }
  reviewers?: { displayName?: string; vote?: number }[]
  repository?: { webUrl?: string }; url?: string
}

const AZURE_VOTE: Record<number, string> = { 10: 'APPROVED', 5: 'APPROVED', 0: 'COMMENTED', [-5]: 'CHANGES_REQUESTED', [-10]: 'CHANGES_REQUESTED' }

export function normalizeAzure(pr: AzurePr): PullRequest {
  const branch = (ref: string) => ref.replace(/^refs\/heads\//, '')
  const votes = (pr.reviewers ?? []).filter(r => r.vote)
  return {
    provider: 'azure',
    number: pr.pullRequestId,
    title: pr.title,
    body: pr.description ?? '',
    state: pr.status === 'active' ? 'OPEN' : pr.status === 'completed' ? 'MERGED' : 'CLOSED',
    url: pr.repository?.webUrl ? `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}` : (pr.url ?? ''),
    isDraft: Boolean(pr.isDraft),
    author: pr.createdBy ? { login: pr.createdBy.displayName ?? pr.createdBy.uniqueName ?? '' } : undefined,
    baseRefName: branch(pr.targetRefName),
    headRefName: branch(pr.sourceRefName),
    baseRefOid: pr.lastMergeTargetCommit?.commitId ?? '',
    headRefOid: pr.lastMergeSourceCommit?.commitId ?? '',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    reviewDecision: votes.some(v => (v.vote ?? 0) < 0) ? 'CHANGES_REQUESTED' : votes.some(v => (v.vote ?? 0) > 0) ? 'APPROVED' : undefined,
    createdAt: pr.creationDate,
    updatedAt: pr.closedDate ?? pr.creationDate,
    reviews: votes.map(v => ({ author: { login: v.displayName ?? '' }, state: AZURE_VOTE[v.vote ?? 0] ?? 'COMMENTED', body: '', submittedAt: pr.creationDate })),
    comments: [],
    statusCheckRollup: [],
  }
}

// ---------------------------------------------------------------- one interface

const cache = new Map<string, { at: number; pr: PullRequest }>()

/** The PR for a number, or for the branch checked out in `root`; null when the branch has none. */
export async function prView(root: string, number?: number): Promise<PullRequest | null> {
  const key = `${root}#${number ?? 'branch'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.pr
  const provider = await providerFor(root)
  let pr: PullRequest | null
  if (provider === 'github') {
    const res = await cli(provider, root, ['pr', 'view', ...(number ? [String(number)] : []), '--json', GH_FIELDS])
    if (!res.ok) { if (NONE.test(res.err)) return null; throw new HttpError(502, explain(provider, res.err)) }
    pr = { provider, ...(JSON.parse(res.out) as Omit<PullRequest, 'provider'>) }
  } else if (provider === 'gitlab') {
    const res = await cli(provider, root, ['mr', 'view', ...(number ? [String(number)] : []), '--output', 'json'])
    if (!res.ok) { if (NONE.test(res.err)) return null; throw new HttpError(502, explain(provider, res.err)) }
    const mr = JSON.parse(res.out) as GitlabMr & { project_id?: number }
    let notes: GitlabNote[] = []
    if (mr.project_id) {
      const n = await cli(provider, root, ['api', `projects/${mr.project_id}/merge_requests/${mr.iid}/notes?sort=asc&per_page=100`])
      if (n.ok) notes = JSON.parse(n.out) as GitlabNote[]
    }
    pr = normalizeGitlab(mr, notes)
  } else {
    let id = number
    if (!id) {
      const branch = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true })).trim()
      const list = await cli(provider, root, ['repos', 'pr', 'list', '--source-branch', branch, '--status', 'active', '-o', 'json', '--detect', 'true'])
      if (!list.ok) throw new HttpError(502, explain(provider, list.err))
      id = (JSON.parse(list.out) as AzurePr[])[0]?.pullRequestId
      if (!id) return null
    }
    const res = await cli(provider, root, ['repos', 'pr', 'show', '--id', String(id), '-o', 'json', '--detect', 'true'])
    if (!res.ok) { if (NONE.test(res.err)) return null; throw new HttpError(502, explain(provider, res.err)) }
    pr = normalizeAzure(JSON.parse(res.out) as AzurePr)
  }
  cache.set(key, { at: Date.now(), pr })
  cache.set(`${root}#${pr.number}`, { at: Date.now(), pr })
  return pr
}

export async function prList(root: string): Promise<PrListItem[]> {
  const provider = await providerFor(root)
  if (provider === 'github') {
    const res = await cli(provider, root, ['pr', 'list', '--limit', '40', '--json', 'number,title,headRefName,author,updatedAt,isDraft'])
    if (!res.ok) throw new HttpError(502, explain(provider, res.err))
    return JSON.parse(res.out) as PrListItem[]
  }
  if (provider === 'gitlab') {
    const res = await cli(provider, root, ['mr', 'list', '--per-page', '40', '--output', 'json'])
    if (!res.ok) throw new HttpError(502, explain(provider, res.err))
    return (JSON.parse(res.out) as GitlabMr[]).map(m => ({ number: m.iid, title: m.title, headRefName: m.source_branch, author: m.author?.username ? { login: m.author.username } : undefined, updatedAt: m.updated_at, isDraft: Boolean(m.draft) }))
  }
  const res = await cli(provider, root, ['repos', 'pr', 'list', '--status', 'active', '--top', '40', '-o', 'json', '--detect', 'true'])
  if (!res.ok) throw new HttpError(502, explain(provider, res.err))
  return (JSON.parse(res.out) as AzurePr[]).map(p => normalizeAzure(p)).map(p => ({ number: p.number, title: p.title, headRefName: p.headRefName, author: p.author, updatedAt: p.updatedAt, isDraft: p.isDraft }))
}

/** The PR's patch from the host, for when its commits are not in the local repo. */
export async function prDiff(root: string, number: number): Promise<string> {
  const provider = await providerFor(root)
  if (provider === 'azure') throw new HttpError(409, '이 PR의 커밋이 로컬에 없어. `git fetch` 후 다시 시도해.')
  const res = provider === 'github'
    ? await cli(provider, root, ['pr', 'diff', String(number), '--color', 'never'])
    : await cli(provider, root, ['mr', 'diff', String(number), '--color', 'never'])
  if (!res.ok) throw new HttpError(502, explain(provider, res.err))
  return res.out
}
