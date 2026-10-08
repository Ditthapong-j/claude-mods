import { describe, expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { evaluate, startShip } from '../hooks/steps'
import type { Ship } from '../hooks/steps'

const P = { isFullscreen: false, columns: 160 }
type W = {
	prs?: string
	proof?: () => string
	submitted: string[]
	filled: string[]
	ran: string[]
	spawn?: () => { agentId: string } | { deny: string }
}

function world(on: On, w: W): MockClock {
	const clock = mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	on('command.register', ($, e) => ({ value: { command: e.name } }))
	on('process.run', ($, e) => {
		const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
		if (e.argv[0] === 'gh') return ok(w.prs ?? '[]')
		if (e.argv.join(' ').startsWith('git worktree list')) return ok('worktree /r\nHEAD a\nbranch refs/heads/fix/x\n')
		return ok('')
	})
	on('tool.call', { tool: 'mcp__proof__status' }, () => (w.proof === undefined ? { deny: 'no such tool' } : { result: w.proof() }))
	on('tool.call', { tool: 'Bash' }, ($, e) => {
		w.ran.push(e.command)
		return { result: { stdout: 'ok', stderr: '', interrupted: false } }
	})
	on('agent.spawn', () => {
		const r = w.spawn?.() ?? { agentId: 'rev-1' }
		return 'deny' in r ? r : { model: 'm', agentId: r.agentId }
	})
	on('prompt.submit', ($, e) => {
		w.submitted.push(e.text)
		return { text: e.text }
	})
	on('prompt.fill', ($, e) => {
		w.filled.push(e.text)
		return { isFilled: true }
	})
	on('turn.complete', ($, e) => ({ text: e.answer }))
	on('ui.open', () => ({ value: { isPlaced: true as const } }))
	on('ui.toast', () => ({ value: undefined }))
	return clock
}

const done = (answer: string, extra: Record<string, unknown> = {}) => ({
	reason: 'answer' as const,
	answer,
	durationMs: 1,
	isAborted: false,
	turnId: 't',
	...extra,
})

async function start($: Engine, issue = '#1 x'): Promise<void> {
	await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
	await $.command.run({ command: 'ship', args: issue, origin: { kind: 'composer' }, presentation: P })
	// ผู้ใช้กด Enter ส่งขั้นแรกที่อยู่ในช่องพิมพ์
	await $.prompt.submit({ text: '[autopilot · #1 x · ขั้น 1/7] go', origin: { kind: 'composer' }, wait: false })
}

describe('autopilot review fixes', () => {
	test('#1 push and PR commands are denied while a ship runs, until the person approves the PR step', async ($, on) => {
		const w: W = { submitted: [], filled: [], ran: [] }
		world(on, w)
		await start($)
		const push = await $.tool.call({ tool: 'Bash', command: 'git push -u origin fix/x' })
		expect(push.deny).toContain('autopilot')
		const pr = await $.tool.call({ tool: 'Bash', command: 'cd /r && gh pr create --fill' })
		expect(pr.deny).toContain('autopilot')
		expect(w.ran).toEqual([])
	})

	test('#2 approving a duplicate at step 1 moves on to step 2', async ($, on) => {
		const w: W = { submitted: [], filled: [], ran: [], prs: '[{"number":9,"title":"dup"}]' }
		world(on, w)
		await start($)
		await $.turn.complete(done('มี PR #9'))
		await $.command.run({ command: 'ship', args: 'approve', origin: { kind: 'composer' }, presentation: P })
		const last = [...w.submitted, ...w.filled].at(-1) ?? ''
		expect(last).toContain('ขั้น 2/7')
	})

	test('#3 review: a refused reviewer blocks with a reason; a BLOCKING line decides', () => {
		const s: Ship = { ...startShip('x', 'origin/main', 'general-purpose'), step: 'review' }
		expect(evaluate(s, { review: { blocking: 0 } })).toBe('pass')
		expect(evaluate(s, { review: { blocking: 2 } })).toBe('retry')
		expect(evaluate(s, { review: { blocking: null } })).toBe('needs-person')
	})

	test('#4 proof step with no proof plugin waits for the person; stale results do not count', () => {
		const s: Ship = { ...startShip('x', 'origin/main', 'general-purpose'), step: 'proof', stepStartedAt: 100 }
		expect(evaluate(s, { proof: null })).toBe('needs-person')
		expect(evaluate(s, { proof: { fresh: [] } })).toBe('retry')
		expect(evaluate(s, { proof: { fresh: [{ status: 'pass' }] } })).toBe('pass')
		const red: Ship = { ...s, step: 'red-test' }
		expect(evaluate(red, { proof: { fresh: [] } })).toBe('retry')
		expect(evaluate(red, { proof: { fresh: [{ status: 'fail' }] } })).toBe('pass')
	})

	test('#5 an interrupted turn stops and waits; a turn autopilot did not start is ignored', async ($, on) => {
		const w: W = { submitted: [], filled: [], ran: [] }
		world(on, w)
		await start($)
		await $.turn.complete(done('x', { isAborted: true, reason: 'aborted' }))
		const status = await $.command.run({ command: 'ship', args: 'status', origin: { kind: 'composer' }, presentation: P })
		expect(status.text).toContain('รอผู้ใช้')
		expect(w.submitted.filter((t) => !t.endsWith('] go'))).toEqual([])
	})

	test('#5 a turn the person started for something else is not evaluated', async ($, on) => {
		const w: W = { submitted: [], filled: [], ran: [] }
		world(on, w)
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		await $.command.run({ command: 'ship', args: '#1 x', origin: { kind: 'composer' }, presentation: P })
		await $.prompt.submit({ text: 'ช่วยอธิบายไฟล์นี้หน่อย', origin: { kind: 'composer' }, wait: false })
		await $.turn.complete(done('อธิบายแล้ว'))
		expect(w.submitted.filter((t) => t.includes('ขั้น 2/7'))).toEqual([])
	})
})
