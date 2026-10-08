import { describe, expect, test } from 'claude-code/testing'

import { bandText, continuePrompt, settle, statusLine } from '../hooks/results'
import type { ProofResult } from '../hooks/results'

const r = (label: string, status: ProofResult['status']): ProofResult => ({
	id: label,
	label,
	status,
	exitCode: status === 'fail' ? 1 : 0,
	tail: `${label} log`,
	at: 0,
	durationMs: 1000,
})

describe('results', () => {
	test('status line counts', () => {
		expect(statusLine([])).toBeUndefined()
		expect(statusLine([r('a', 'pass'), r('b', 'fail'), r('c', 'running'), r('d', 'flaky')])).toBe(
			'proof: 1 ✓ · 1 ✗ · 1 flaky · รันอยู่ 1'
		)
	})
	test('band only when something is red or still running', () => {
		expect(bandText([r('a', 'pass')])).toBeUndefined()
		expect(bandText([r('a', 'fail')])).toContain('1')
		expect(bandText([r('a', 'running')])).toContain('ยังรัน')
	})
	test('continue prompt carries each failure with its tail', () => {
		const p = continuePrompt([r('npx tsc', 'fail'), r('ok', 'pass')])
		expect(p).toContain('npx tsc')
		expect(p).toContain('npx tsc log')
		expect(p).not.toContain('ok log')
	})
	test('settle: pass, flaky, fail', () => {
		expect(settle([{ exitCode: 0 }])).toBe('pass')
		expect(settle([{ exitCode: 1 }, { exitCode: 0 }])).toBe('flaky')
		expect(settle([{ exitCode: 1 }, { exitCode: 1 }, { exitCode: 1 }])).toBe('fail')
	})
})
