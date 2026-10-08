import { describe, expect, test } from 'claude-code/testing'

import { proofWorld } from './helpers'

const GUARDS = {
	'/r/.claude/guards.json': '{"proof":{"apps/web/**":"npx tsc -p apps/web/tsconfig.app.json --noEmit"}}',
}
const P = { isFullscreen: false, columns: 120 }
const edit = (file_path: string) => ({ tool: 'Edit' as const, file_path, old_string: 'a', new_string: 'b' })

describe('proof in a session', () => {
	test('edits are debounced into one run of each proof command', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const status: (string | undefined)[] = []
		const clock = proofWorld(on, { files: GUARDS, runs, status })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		for (let i = 0; i < 20; i++) await $.tool.call(edit(`/r/apps/web/src/a${i}.tsx`))
		expect(runs).toEqual([])
		await clock.advance(5000)
		expect(runs.map((r) => r.argv.join(' '))).toEqual(['npx tsc -p apps/web/tsconfig.app.json --noEmit'])
		expect(status.at(-1)).toBe('proof: 1 ✓ · 0 ✗')
	})

	test('a failure is retried twice, then the band offers to continue', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const submitted: string[] = []
		const filled: string[] = []
		const clock = proofWorld(on, { files: GUARDS, runs, submitted, filled, exit: () => 1 })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		await $.tool.call(edit('/r/apps/web/src/a.tsx'))
		await clock.advance(5000)
		expect(runs.length).toBe(3)
		await $.turn.complete({ reason: 'answer', answer: 'เสร็จแล้วครับ', durationMs: 1000, isAborted: false, turnId: 't1' })
		const res = await $.command.run({
			command: 'proof',
			args: 'continue',
			origin: { kind: 'composer' },
			presentation: P,
		})
		// จาก command.run host ไม่ให้ submit จึงต้องได้ข้อความในช่องพิมพ์แทน
		expect(res.text).toContain('กด Enter')
		expect(submitted).toEqual([])
		expect(filled[0]).toContain('npx tsc -p apps/web/tsconfig.app.json --noEmit')
	})

	test('off stops automatic runs; status tool reports state', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const clock = proofWorld(on, { files: GUARDS, runs })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		await $.command.run({ command: 'proof', args: 'off', origin: { kind: 'composer' }, presentation: P })
		await $.tool.call(edit('/r/apps/web/src/a.tsx'))
		await clock.advance(5000)
		expect(runs).toEqual([])
		const status = await $.tool.call({ tool: 'mcp__proof__status' })
		expect((JSON.parse(String(status.result)) as { enabled: boolean }).enabled).toBe(false)
	})
})
