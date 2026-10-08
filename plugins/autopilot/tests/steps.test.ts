import { describe, expect, test } from 'claude-code/testing'

import { advance, evaluate, MAX_ATTEMPTS, startShip, stepPrompt } from '../hooks/steps'

describe('ship state machine', () => {
	test('starts at understand and its prompt names the issue and the duplicate check', () => {
		const s = startShip('#4120 ยอดในสลิปไม่ตรง', 'origin/develop', 'code-review')
		expect(s.step).toBe('understand')
		expect(stepPrompt(s)).toContain('#4120')
		expect(stepPrompt(s)).toContain('gh pr list')
	})
	test('evaluate per step', () => {
		const s = startShip('x', 'origin/develop', 'code-review')
		expect(evaluate(s, { duplicates: [] })).toBe('pass')
		expect(evaluate(s, { duplicates: ['PR #9'] })).toBe('needs-person')
		expect(evaluate({ ...s, step: 'worktree', branch: 'fix/x' }, { worktreeBranch: 'fix/x' })).toBe('pass')
		expect(evaluate({ ...s, step: 'red-test' }, { proof: { fail: 1, pass: 0, running: 0, newFailing: true } })).toBe(
			'pass'
		)
		expect(evaluate({ ...s, step: 'red-test' }, { proof: { fail: 0, pass: 1, running: 0, newFailing: false } })).toBe(
			'retry'
		)
		expect(evaluate({ ...s, step: 'fix' }, {})).toBe('pass')
		expect(evaluate({ ...s, step: 'proof' }, { proof: { fail: 0, pass: 2, running: 0, newFailing: false } })).toBe(
			'pass'
		)
		expect(evaluate({ ...s, step: 'proof' }, { proof: { fail: 0, pass: 1, running: 1, newFailing: false } })).toBe(
			'retry'
		)
		expect(evaluate({ ...s, step: 'review' }, { review: { blocking: 0 } })).toBe('pass')
		expect(evaluate({ ...s, step: 'review' }, { review: { blocking: 2 } })).toBe('retry')
	})
	test('advance stops at the PR gate and blocks after too many retries', () => {
		let s = { ...startShip('x', 'origin/develop', 'code-review'), step: 'review' as const }
		s = advance(s, 'pass')
		expect(s.step).toBe('open-pr')
		expect(s.status).toBe('waiting-person')
		let r = { ...startShip('x', 'origin/develop', 'code-review'), step: 'proof' as const }
		for (let i = 0; i < MAX_ATTEMPTS; i++) r = advance(r, 'retry')
		expect(r.status).toBe('blocked')
		expect(r.log.at(-1)).toContain('proof')
	})
})
