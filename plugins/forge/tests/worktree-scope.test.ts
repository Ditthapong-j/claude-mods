import { describe, expect, test } from 'claude-code/testing'

import { personalFor, worktreeHome } from '../hooks/personal'
import type { PersonalRule } from '../hooks/personal'
import { world } from './helpers'

const P = { isFullscreen: false, columns: 120 }
const DRAFT =
	'{"id":"no-bare-checkout","tool":"Bash","match":"git checkout -b \\\\S+$","action":"deny","why":"แตกจากฐานเสมอ","examples":{"hit":["git checkout -b fix/a"],"miss":["git checkout -b fix/a origin/develop","git status"]}}'

// worktree ทุกอันของ /wt-main ชี้ git-common-dir ไปที่ /wt-main/.git · /wt-other เป็นอีก repo
const git = (argv: readonly string[], init?: { cwd?: string }) => {
	const cwd = init?.cwd ?? ''
	const top = cwd.startsWith('/wt-main') ? (/^\/wt-main\/\.claude\/worktrees\/[^/]+/.exec(cwd)?.[0] ?? '/wt-main') : '/wt-other'
	const args = argv.join(' ')
	if (args === 'git rev-parse --show-toplevel') return { exitCode: 0, stdout: `${top}\n` }
	if (args === 'git rev-parse --path-format=absolute --git-common-dir') {
		return { exitCode: 0, stdout: `${top.startsWith('/wt-main') ? '/wt-main' : '/wt-other'}/.git\n` }
	}
	return undefined
}

describe('"เฉพาะ repo นี้" binds to the main repo, not the worktree', () => {
	test('a rule accepted in one worktree applies in another worktree of the same repo', async ($, on) => {
		world(on, { cwd: '/wt-main/.claude/worktrees/a', run: git })
		on('model.classify', () => ({ value: 'correction' }))
		on('model.complete', () => ({
			value: {
				isAnswered: true,
				text: DRAFT,
				usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
			},
		}))
		on('prompt.submit', ($, e) => ({ text: e.text }))
		on('turn.complete', ($, e) => ({ text: e.answer }))
		await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/a' })
		await $.prompt.submit({ text: 'อย่าแตก branch แบบนี้ ให้ระบุฐานเสมอ', origin: { kind: 'composer' }, wait: false })
		await $.turn.complete({ reason: 'answer', answer: 'ขอโทษครับ', durationMs: 1, isAborted: false, turnId: 't1' })
		const accepted = await $.command.run({
			command: 'lessons',
			args: 'accept repo',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(accepted.text).toContain('no-bare-checkout')

		const other = await $.tool.call({ tool: 'Bash', command: 'cd /wt-main/.claude/worktrees/b && git checkout -b fix/b' })
		expect(other.deny).toContain('no-bare-checkout')
		const main = await $.tool.call({ tool: 'Bash', command: 'cd /wt-main && git checkout -b fix/c' })
		expect(main.deny).toContain('no-bare-checkout')
		const elsewhere = await $.tool.call({ tool: 'Bash', command: 'cd /wt-other && git checkout -b fix/d' })
		expect(elsewhere.deny).toBeUndefined()
	})
})

describe('rules stored before this change (bound to a worktree path)', () => {
	const rule = (id: string, root: string): PersonalRule => ({
		rule: {
			id,
			tools: ['Bash'],
			field: 'command',
			match: 'x',
			action: 'deny',
			why: 'w',
			examples: { hit: [], miss: [] },
			enabled: true,
		},
		scope: { kind: 'repo', root },
		createdAt: 0,
		lesson: 'l',
	})
	test('worktreeHome strips the worktree folder', () => {
		expect(worktreeHome('/r/.claude/worktrees/x-1')).toBe('/r')
		expect(worktreeHome('/r/.worktrees/x')).toBe('/r')
		expect(worktreeHome('/r')).toBe('/r')
		expect(worktreeHome('/r/apps/worktrees/x')).toBe('/r/apps/worktrees/x')
	})
	test('a worktree-bound rule still applies to the main repo and its other worktrees', () => {
		const list = [rule('old', '/r/.claude/worktrees/gone'), rule('new', '/r'), rule('far', '/s')]
		expect(personalFor(list, '/r').repo.map((r) => r.id)).toEqual(['old', 'new'])
		expect(personalFor(list, '/s').repo.map((r) => r.id)).toEqual(['far'])
	})
})
