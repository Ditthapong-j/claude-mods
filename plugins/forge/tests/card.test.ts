import { describe, expect, test } from 'claude-code/testing'

import { draftCard } from '../hooks/card'
import { toRule } from '../hooks/config'

const vars = { baseBranch: 'origin/develop', repoRoot: '/r' }
const make = (raw: Record<string, unknown>) => {
	const { rule } = toRule(raw, 0)
	if (rule === undefined) throw new Error('bad rule')
	return rule
}

describe('draft card', () => {
	test('a rewrite rule shows the command before and after, not the regex', () => {
		const rule = make({
			id: 'worktree-base',
			tool: 'Bash',
			match: '(^\\s*|[;&|]\\s*)(git\\s+worktree\\s+add\\s+-b\\s+\\S+\\s+\\S+)(?=\\s*$)',
			action: 'rewrite',
			rewrite: '$1$2 {baseBranch}',
			why: 'worktree ใหม่ต้องแตกจาก develop',
			examples: { hit: ['git worktree add -b fix/a .worktrees/a'], miss: ['git worktree list'] },
		})
		const card = draftCard(rule, 'memory: x', vars)
		expect(card.effect).toContain('แก้คำสั่งให้เอง')
		expect(card.examples).toEqual([
			{ label: 'ก่อน', text: 'git worktree add -b fix/a .worktrees/a' },
			{ label: 'หลัง', text: 'git worktree add -b fix/a .worktrees/a origin/develop' },
			{ label: 'คำสั่งที่ไม่โดน', text: 'git worktree list' },
		])
		expect(JSON.stringify(card)).not.toContain('\\s')
	})
	test('a deny rule says how to let one call through', () => {
		const rule = make({
			id: 'pr-merge-confirm',
			tool: 'Bash',
			match: '\\bgh\\s+pr\\s+merge\\b',
			action: 'deny',
			why: 'merge PR ต้องเป็นการตัดสินใจของผู้ใช้',
			hint: 'บอกผู้ใช้ก่อน',
			examples: { hit: ['gh pr merge 1'], miss: ['gh pr view 1'] },
		})
		const card = draftCard(rule, 'x', vars)
		expect(card.effect).toContain('/guards allow pr-merge-confirm')
		expect(card.hint).toBe('วิธีที่ถูก: บอกผู้ใช้ก่อน')
		expect(card.examples[0]).toEqual({ label: 'คำสั่งที่โดน', text: 'gh pr merge 1' })
	})
	test('long lesson text is clipped to one line', () => {
		const rule = make({ id: 'w', tool: 'Bash', match: 'x', action: 'warn', why: 'w', examples: { hit: ['x'], miss: [] } })
		const card = draftCard(rule, 'ก'.repeat(500), vars)
		expect(card.source.length).toBeLessThanOrEqual(140)
		expect(card.effect).toContain('เตือน')
	})
})
