import { describe, expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const P = { isFullscreen: false, columns: 160 }

function world(on: On, opts: { prs?: string; proof?: string; submitted: string[]; filled?: string[] }): void {
	mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('process.run', ($, e) => {
		const ok = (stdout: string) => ({
			value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
		})
		if (e.argv[0] === 'gh') return ok(opts.prs ?? '[]')
		if (e.argv.join(' ').startsWith('git rev-parse --show-toplevel')) return ok('/r\n')
		return ok('')
	})
	on('tool.call', { tool: 'mcp__proof__status' }, () => ({
		result: opts.proof ?? '{"enabled":true,"touched":[],"results":[]}',
	}))
	on('prompt.submit', ($, e) => {
		opts.submitted.push(e.text)
		return { text: e.text }
	})
	on('prompt.fill', ($, e) => {
		opts.filled?.push(e.text)
		return { isFilled: true }
	})
	on('turn.complete', ($, e) => ({ text: e.answer }))
	on('ui.open', () => ({ value: { isPlaced: true as const } }))
	on('ui.toast', () => ({ value: undefined }))
}

describe('/ship', () => {
	test('starts, submits step 1, and moves on after a clean turn', async ($, on) => {
		const submitted: string[] = []
		const filled: string[] = []
		world(on, { submitted, filled })
		await $.command.run({
			command: 'ship',
			args: '#4120 ยอดในสลิปไม่ตรง',
			origin: { kind: 'composer' },
			presentation: P,
		})
		// ขั้นแรกเริ่มจาก slash command ซึ่ง host ไม่ให้ submit จึงอยู่ในช่องพิมพ์ให้ผู้ใช้กด Enter
		expect(filled[0]).toContain('ขั้น 1/7')
		await $.turn.complete({ reason: 'answer', answer: 'ไม่มีงานซ้ำ', durationMs: 1000, isAborted: false, turnId: 't1' })
		expect(submitted[0]).toContain('ขั้น 2/7')
	})

	test('a duplicate PR stops and waits for the person', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted, prs: '[{"number":9,"title":"fix slip"}]' })
		await $.command.run({ command: 'ship', args: '#4120 slip', origin: { kind: 'composer' }, presentation: P })
		await $.turn.complete({ reason: 'answer', answer: 'มี PR #9', durationMs: 1000, isAborted: false, turnId: 't1' })
		const status = await $.command.run({
			command: 'ship',
			args: 'status',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(status.text).toContain('รอผู้ใช้')
		expect(submitted.length).toBe(0)
	})

	test('approve is refused unless the person typed it', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted })
		await $.command.run({ command: 'ship', args: '#1 x', origin: { kind: 'composer' }, presentation: P })
		const res = await $.command.run({ command: 'ship', args: 'approve', origin: { kind: 'sdk' }, presentation: P })
		expect(res.text).toContain('ผู้ใช้ต้อง')
	})

	test('stop ends the run and no more prompts are sent', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted })
		await $.command.run({ command: 'ship', args: '#1 x', origin: { kind: 'composer' }, presentation: P })
		await $.command.run({ command: 'ship', args: 'stop', origin: { kind: 'composer' }, presentation: P })
		await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1000, isAborted: false, turnId: 't1' })
		expect(submitted.length).toBe(0)
	})
})
