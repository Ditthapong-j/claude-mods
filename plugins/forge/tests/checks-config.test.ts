import { describe, expect, test } from 'claude-code/testing'

import { validateCheckParams } from '../hooks/checks/index'
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
	test('denies when the local version equals the running one', async ($, on) => {
		world(on, {
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.1\n',
			},
			fetch: () => ({
				status: 200,
				text: '{"version":"1.5.1","commit":"abc"}',
			}),
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.deny).toContain('1.5.1')
	})
	test('passes when bumped', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.2',
			},
			fetch: () => ({ status: 200, text: '{"version":"1.5.1"}' }),
		})
		await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(ran).toEqual([DEPLOY])
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
