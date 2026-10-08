import { describe, expect, test } from 'claude-code/testing'

import { parseEnvConfig, parsePeers, parsePrs, parseVersion, parseWorktrees, waiting } from '../hooks/parse'

describe('parse', () => {
	test('worktrees from porcelain', () => {
		const text = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.wt/x\nHEAD def\ndetached\n'
		expect(parseWorktrees(text)).toEqual([
			{ path: '/r', branch: 'main' },
			{ path: '/r/.wt/x', branch: null },
		])
	})
	test('prs with checks and review', () => {
		const json = JSON.stringify([
			{
				number: 1,
				title: 'a',
				headRefName: 'fix/a',
				reviewDecision: 'APPROVED',
				statusCheckRollup: [{ conclusion: 'SUCCESS' }],
			},
			{
				number: 2,
				title: 'b',
				headRefName: 'fix/b',
				reviewDecision: 'CHANGES_REQUESTED',
				statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }],
			},
			{
				number: 3,
				title: 'c',
				headRefName: 'fix/c',
				reviewDecision: '',
				statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
			},
		])
		const prs = parsePrs(json)
		if ('error' in prs) throw new Error(prs.error)
		expect(prs.map((p) => `${p.number}:${p.checks}:${p.review}`)).toEqual([
			'1:pass:approved',
			'2:fail:changes',
			'3:pending:pending',
		])
		expect('error' in parsePrs('not json')).toBe(true)
	})
	test('peers from ListAgents text', () => {
		const text =
			'Peer sessions (2):\n  Fix login [ab6772]  ·  interactive  ·  idle  ·  Claude Desktop session  ·  started 3h ago\n  Deploy [128be5]  ·  Remote Control  ·  offline\n'
		expect(parsePeers(text)).toEqual([
			{ name: 'Fix login', id: 'ab6772', kind: 'interactive', state: 'idle' },
			{ name: 'Deploy', id: '128be5', kind: 'remote', state: 'offline' },
		])
	})
	test('env version rows flag a build without identity', () => {
		expect(parseVersion('DEV', { ok: true, status: 200, text: '{"version":"1.5.1","commit":"abc1234def"}' })).toEqual({
			name: 'DEV',
			service: null,
			version: '1.5.1',
			commit: 'abc1234',
			problem: null,
		})
		expect(
			parseVersion('AI', { ok: true, status: 200, text: '{"version":"0.0.0-dev","commit":"unknown"}' }).problem
		).toContain('build args')
		expect(parseVersion('UAT', { error: 'timeout' }).problem).toBe('timeout')
		expect(parseVersion('X', { ok: false, status: 502, text: '' }).problem).toBe('HTTP 502')
	})
	test('env config and waiting list', () => {
		expect(parseEnvConfig('[{"name":"PROD","url":"https://a.example/v"}]')).toEqual([
			{ name: 'PROD', url: 'https://a.example/v', service: null },
		])
		expect('error' in parseEnvConfig('{')).toBe(true)
		expect(
			waiting(
				[{ number: 2, title: 'b', branch: 'x', checks: 'fail', review: 'changes', checksPass: 0, checksTotal: 1, updatedAt: null }],
				[{ name: 'AI', service: null, version: null, commit: null, problem: 'timeout' }]
			)
		).toEqual(['PR #2 b · CI แดง', 'PR #2 b · ขอแก้จาก review', 'AI · timeout'])
	})
})
