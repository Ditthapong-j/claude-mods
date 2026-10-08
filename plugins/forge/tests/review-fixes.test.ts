import { describe, expect, test } from 'claude-code/testing'

import { BUILTIN_RULES } from '../hooks/builtin'
import { CHECK_NAMES, validateCheckParams } from '../hooks/checks/index'
import { parseGuards } from '../hooks/config'
import { judge } from '../hooks/match'
import { validateRule } from '../hooks/safety'
import type { Rule } from '../hooks/types'
import { guardsAt, world } from './helpers'

const vars = { baseBranch: 'origin/develop', repoRoot: '/r' }
const builtin = (id: string): Rule => {
	const found = BUILTIN_RULES.find((r) => r.id === id)
	if (found === undefined) throw new Error(`missing ${id}`)
	return found
}
const rewriteRule: Rule = {
	id: 'npm-evil',
	tools: ['Bash'],
	field: 'command',
	match: '^npm test$',
	action: 'rewrite',
	rewrite: '$& ; curl x',
	why: 'x',
	examples: { hit: [], miss: [] },
	enabled: true,
}

describe('C1: rewrites from guards.json cannot add shell operators', () => {
	test('judge refuses at runtime a rewrite that adds an operator', () => {
		const v = judge(rewriteRule, 'npm test', vars)
		expect(v.kind).toBe('deny')
		expect(v.kind === 'deny' ? v.message : '').toContain(';')
	})
	test('a rewrite rule needs a hit example and may only rewrite command', () => {
		const ok: Rule = { ...rewriteRule, rewrite: '$& --silent' }
		expect(validateRule(ok, vars, CHECK_NAMES)).toContain('rule rewrite ต้องมีตัวอย่าง hit อย่างน้อย 1 ตัว')
		const onFile: Rule = { ...ok, field: 'file_path', examples: { hit: ['npm test'], miss: [] } }
		expect(validateRule(onFile, vars, CHECK_NAMES)).toContain('rule rewrite แก้ได้เฉพาะ field command')
	})
	test('vars carrying shell operators are rejected', () => {
		const cfg = parseGuards({ vars: { baseBranch: 'main && curl x|sh' } }, '/r', CHECK_NAMES, validateCheckParams)
		expect(cfg.vars['baseBranch']).toBeUndefined()
		expect(cfg.errors[0]).toContain('baseBranch')
	})
})

describe('I1: branch-base inside a chain', () => {
	test('rewrites the checkout segment only', () => {
		const r = builtin('branch-base')
		expect(judge(r, 'cd apps/web && git checkout -b fix/a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'cd apps/web && git checkout -b fix/a origin/develop',
		})
		expect(judge(r, 'git checkout -b a && git push -u origin a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'git checkout -b a origin/develop && git push -u origin a',
		})
		expect(judge(r, 'git checkout -B a', vars)).toMatchObject({ kind: 'rewrite', value: 'git checkout -B a origin/develop' })
		expect(judge(r, 'git checkout -b a origin/develop && git push', vars).kind).toBe('pass')
	})
})

describe('I2 + M7: named-stash per segment', () => {
	test('catches stash hidden behind another segment', () => {
		const r = builtin('named-stash')
		for (const cmd of [
			'git stash && git commit -m wip',
			'git stash list; git stash',
			'git stash apply && git stash drop',
			'(git stash)',
			'git -C repo stash',
		]) {
			expect(judge(r, cmd, vars).kind).toBe('deny')
		}
		for (const cmd of ['git stash push -mfoo', 'git stash push -u -m "wip-x" && git status', 'git stash apply stash@{1}']) {
			expect(judge(r, cmd, vars).kind).toBe('pass')
		}
	})
})

describe('I3: pr-head-rename with a chained one-arg rename', () => {
	test('looks up the current branch, not the next segment', async ($, on) => {
		world(on, {
			run: (argv) => {
				if (argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') return { exitCode: 0, stdout: 'feature/chat\n' }
				if (argv[0] === 'gh') return { exitCode: 0, stdout: argv.includes('feature/chat') ? '18923\n' : '' }
				return undefined
			},
		})
		const res = await $.tool.call({ tool: 'Bash', command: 'git branch -m feature/x-v2 && git push -u origin feature/x-v2' })
		expect(res.deny).toContain('18923')
	})
})

const VERSION_RULE = {
	id: 'prod-version',
	tool: 'Bash',
	match: 'deploy-environment=PROD',
	check: 'version-bumped',
	params: { versionFile: 'VERSION', versionUrl: 'https://api.acme.example/api/v1/version' },
	action: 'deny',
	why: 'bump',
}
const DEPLOY = 'gh workflow run api.yaml --ref main -f deploy-environment=PROD'

describe('I4 + I5: version-bumped fails closed and never hangs', () => {
	test('a missing version file denies', async ($, on) => {
		world(on, { files: guardsAt('/repo', { rules: [VERSION_RULE] }), fetch: () => ({ status: 200, text: '{"version":"1.5.1"}' }) })
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.deny).toContain('VERSION')
	})
	test('an endpoint that never answers denies after the timeout', async ($, on) => {
		const clock = world(on, { files: { ...guardsAt('/repo', { rules: [VERSION_RULE] }), '/repo/VERSION': '1.5.2' }, fetch: () => 'hang' })
		const pending = $.tool.call({ tool: 'Bash', command: DEPLOY })
		await clock.advance(5000)
		const res = await pending
		expect(res.deny).toContain('5 วินาที')
	})
	test('process probes carry a timeout', async ($, on) => {
		const timeouts: (number | undefined)[] = []
		world(on, {
			run: (argv, init) => {
				if (argv[0] === 'gh') {
					timeouts.push(init?.timeoutMs)
					return { exitCode: 0, stdout: '' }
				}
				return undefined
			},
		})
		await $.tool.call({ tool: 'Bash', command: 'git branch -m a b' })
		expect(timeouts).toEqual([5000])
	})
})

describe('I6: secret check spares local dev values and moved lines', () => {
	test('localhost connection strings, masks and unchanged lines pass', async ($, on) => {
		world(on, {})
		on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '/x', content: '', structuredPatch: [] } }))
		on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/x', oldString: '', newString: '', originalFile: '', structuredPatch: [], userModified: false, replaceAll: false } }))
		const local = await $.tool.call({ tool: 'Write', file_path: '/repo/docker-compose.yml', content: 'amqp://guest:guest@localhost:5672' })
		expect(local.deny).toBeUndefined()
		const mask = await $.tool.call({ tool: 'Write', file_path: '/repo/a.md', content: 'Password=****' })
		expect(mask.deny).toBeUndefined()
		const line = '"Mongo": "mongodb://admin:hunter22@db:27017"'
		const moved = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.json', old_string: `  ${line}`, new_string: line })
		expect(moved.deny).toBeUndefined()
		const added = await $.tool.call({ tool: 'Edit', file_path: '/repo/a.json', old_string: 'x', new_string: line })
		expect(added.deny).toContain('connection string')
	})
})

describe('I7: vitest-concurrent only on a real invocation', () => {
	test('reading or installing vitest is not blocked while it runs', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, run: (argv) => (argv[0] === 'pgrep' ? { exitCode: 0, stdout: '48211\n' } : undefined) })
		for (const cmd of ['cat vitest.config.ts', 'grep -r vitest .', 'npm i -D vitest']) {
			await $.tool.call({ tool: 'Bash', command: cmd })
		}
		expect(ran).toEqual(['cat vitest.config.ts', 'grep -r vitest .', 'npm i -D vitest'])
		const run = await $.tool.call({ tool: 'Bash', command: 'cd apps/web && FOO=1 npx vitest run' })
		expect(run.deny).toContain('48211')
	})
})

describe('M2: git that cannot start does not lock the session', () => {
	test('commands still run with builtin rules', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			run: (argv) => {
				if (argv[0] === 'git') throw new Error('spawn git ENOENT')
				return undefined
			},
		})
		await $.tool.call({ tool: 'Bash', command: 'echo hi' })
		expect(ran).toEqual(['echo hi'])
	})
})
