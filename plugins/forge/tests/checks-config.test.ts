import { describe, expect, test } from 'claude-code/testing'

import { validateCheckParams } from '../hooks/checks/index'
import { compareVersions, deployRef } from '../hooks/checks/version-bumped'
import { guardsAt, world } from './helpers'

const VERSION_RULE = {
	id: 'prod-version',
	tool: 'Bash',
	match: 'deploy-environment=PROD',
	check: 'version-bumped',
	params: {
		versionFile: 'VERSION',
		versionUrl: 'https://api.acme.example/api/v1/version',
	},
	action: 'deny',
	why: 'bump version ก่อน deploy PROD',
}
const COST_RULE = {
	id: 'eval-cost',
	tool: 'Bash',
	match: 'evals/run\\.py',
	check: 'cost-estimate',
	params: { estimateBaht: 20, maxBaht: 100, paidPattern: '--allow-paid-judge' },
	action: 'deny',
	why: 'ประมาณค่าใช้จ่ายก่อนรัน eval',
}
const DEPLOY = 'gh workflow run api.yaml --ref main -f deploy-environment=PROD'

describe('version-bumped', () => {
	// VERSION ของ ref ที่ deploy มาจาก gh api (raw) หรือ git show origin/<ref>:VERSION — ไม่ใช่ไฟล์ใน checkout
	const onRef = (version: string | null, viaOrigin = false) => (argv: readonly string[]) => {
		if (argv[0] === 'gh' && argv[1] === 'api') return viaOrigin || version === null ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: `${version}\n` }
		if (argv[0] === 'git' && argv[1] === 'show') return viaOrigin && version !== null ? { exitCode: 0, stdout: version } : { exitCode: 128, stdout: '' }
		return undefined
	}
	test('denies when the deployed ref has the running version', async ($, on) => {
		world(on, {
			files: guardsAt('/repo', { rules: [VERSION_RULE] }),
			run: onRef('1.5.1'),
			fetch: () => ({ status: 200, text: '{"version":"1.5.1","commit":"abc"}' }),
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.deny).toContain('1.5.1')
		expect(res.deny).toContain('main')
	})
	test('passes when bumped', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			files: guardsAt('/repo', { rules: [VERSION_RULE] }),
			run: onRef('1.5.2'),
			fetch: () => ({ status: 200, text: '{"version":"1.5.1"}' }),
		})
		await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(ran).toEqual([DEPLOY])
	})
	test('ignores a stale local VERSION and reads the deployed ref', async ($, on) => {
		const ran: string[] = []
		const asked: string[] = []
		world(on, {
			ran,
			files: { ...guardsAt('/repo', { rules: [VERSION_RULE] }), '/repo/VERSION': '1.5.1' },
			run: (argv) => {
				if (argv[0] === 'gh') asked.push(argv.join(' '))
				return onRef('1.5.2')(argv)
			},
			fetch: () => ({ status: 200, text: '{"version":"1.5.1"}' }),
		})
		await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(ran).toEqual([DEPLOY])
		expect(asked[0]).toContain('contents/VERSION?ref=main')
	})
	test('falls back to origin/<ref> when GitHub does not answer', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			files: guardsAt('/repo', { rules: [VERSION_RULE] }),
			run: onRef('1.6.0', true),
			fetch: () => ({ status: 200, text: '{"version":"1.5.9"}' }),
		})
		await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(ran).toEqual([DEPLOY])
	})
	test('denies a version lower than the running one', async ($, on) => {
		world(on, {
			files: guardsAt('/repo', { rules: [VERSION_RULE] }),
			run: onRef('1.5.10'),
			fetch: () => ({ status: 200, text: '{"version":"1.6.0"}' }),
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.deny).toContain('ต่ำกว่า')
	})
	test('compares numerically and reads --ref= forms', () => {
		expect(compareVersions('1.5.10', '1.5.9')).toBeGreaterThan(0)
		expect(compareVersions('1.6', '1.6.0')).toBe(0)
		expect(compareVersions('abc', '1.0.0')).toBeUndefined()
		expect(deployRef('gh workflow run api.yaml --ref=origin/main -f x=1', 'develop')).toBe('main')
		expect(deployRef('gh workflow run api.yaml -f x=1', 'main')).toBe('main')
	})
	test('an unreachable version endpoint denies with the reason', async ($, on) => {
		world(on, {
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.2',
			},
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.deny).toContain('599')
	})
	test('params are required', () => {
		expect(validateCheckParams('version-bumped', {}).length).toBe(2)
	})
})

describe('cost-estimate', () => {
	test('warns with the estimate under the cap', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, files: guardsAt('/repo', { rules: [COST_RULE] }) })
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py --phase p6c',
		})
		expect(ran.length).toBe(1)
		expect(res.context?.join('\n')).toContain('20 บาท')
	})
	test('denies a paid option', async ($, on) => {
		world(on, { files: guardsAt('/repo', { rules: [COST_RULE] }) })
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py --allow-paid-judge',
		})
		expect(res.deny).toContain('/guards allow eval-cost')
	})
	test('denies over the cap', async ($, on) => {
		world(on, {
			files: guardsAt('/repo', {
				rules: [{ ...COST_RULE, params: { estimateBaht: 300, maxBaht: 100 } }],
			}),
		})
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py',
		})
		expect(res.deny).toBeDefined()
	})
	test('params are validated', () => {
		expect(validateCheckParams('cost-estimate', { estimateBaht: 'x', maxBaht: 1 })).toContain(
			'params.estimateBaht ต้องเป็นตัวเลข'
		)
	})
})
