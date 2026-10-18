import { describe, expect, it } from 'vitest'
import { normalizeAzure, normalizeGitlab, providerOf } from '../server/git/pr.ts'

describe('providerOf', () => {
  it('tells the host from the origin url', () => {
    expect(providerOf('git@github.com:acme/server.git')).toBe('github')
    expect(providerOf('https://gitlab.com/group/proj.git')).toBe('gitlab')
    expect(providerOf('git@gitlab.company.io:team/app.git')).toBe('gitlab')
    expect(providerOf('https://org@dev.azure.com/org/Project/_git/repo')).toBe('azure')
    expect(providerOf('git@ssh.dev.azure.com:v3/org/Project/repo')).toBe('azure')
    expect(providerOf('https://org.visualstudio.com/Project/_git/repo')).toBe('azure')
  })
})

describe('normalizeGitlab', () => {
  it('maps a merge request and its notes to the shared shape', () => {
    const pr = normalizeGitlab({
      iid: 12, title: 'Add worker', description: 'body', state: 'opened', web_url: 'https://gitlab.com/g/p/-/merge_requests/12', draft: true,
      author: { username: 'kim' }, target_branch: 'main', source_branch: 'feature/x', diff_refs: { base_sha: 'aaa', head_sha: 'bbb' },
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', changes_count: '7', head_pipeline: { status: 'failed', web_url: 'u' },
    }, [{ body: 'looks good', author: { username: 'lee' }, created_at: '2026-10-02T00:00:00Z' }, { body: 'added 1 commit', created_at: '2026-10-02T00:00:00Z', system: true }])
    expect(pr).toMatchObject({ provider: 'gitlab', number: 12, state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'feature/x', baseRefOid: 'aaa', headRefOid: 'bbb', changedFiles: 7 })
    expect(pr.comments).toHaveLength(1)
    expect(pr.statusCheckRollup[0].conclusion).toBe('FAILURE')
  })
})

describe('normalizeAzure', () => {
  it('maps a pull request, its branches and votes', () => {
    const pr = normalizeAzure({
      pullRequestId: 88, title: 'Fix', status: 'active', creationDate: '2026-10-01T00:00:00Z',
      sourceRefName: 'refs/heads/feature/y', targetRefName: 'refs/heads/develop',
      lastMergeSourceCommit: { commitId: 'head' }, lastMergeTargetCommit: { commitId: 'base' },
      reviewers: [{ displayName: 'Park', vote: 10 }, { displayName: 'Choi', vote: 0 }], repository: { webUrl: 'https://dev.azure.com/o/p/_git/r' },
    })
    expect(pr).toMatchObject({ provider: 'azure', number: 88, state: 'OPEN', headRefName: 'feature/y', baseRefName: 'develop', headRefOid: 'head', baseRefOid: 'base', reviewDecision: 'APPROVED' })
    expect(pr.url).toBe('https://dev.azure.com/o/p/_git/r/pullrequest/88')
    expect(pr.reviews).toHaveLength(1)
  })
})
