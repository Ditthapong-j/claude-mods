import { describe, expect, test } from 'claude-code/testing'

import { validateRule } from '../hooks/safety'
import type { Rule } from '../hooks/types'

const CHECKS = new Set(['secret'])

const ok: Rule = {
	id: 'branch-base',
	tools: ['Bash'],
	field: 'command',
	match: '^(\\s*git\\s+checkout\\s+-b\\s+\\S+)\\s*$',
	action: 'rewrite',
	rewrite: '$1 {baseBranch}',
	why: 'x',
	examples: {
		hit: ['git checkout -b a'],
		miss: ['git checkout -b a origin/develop', 'git checkout main'],
	},
	enabled: true,
}
const vars = { baseBranch: 'origin/develop' }

describe('validateRule', () => {
	test('a good rule has no errors', () => {
		expect(validateRule(ok, vars, CHECKS)).toEqual([])
	})
	test('bad id, empty tools, broken regex', () => {
		const errors = validateRule({ ...ok, id: 'Bad Id', tools: [], match: '(' }, vars, CHECKS)
		expect(errors.some((e) => e.includes('id'))).toBe(true)
		expect(errors.some((e) => e.includes('tools'))).toBe(true)
		expect(errors.some((e) => e.includes('regex'))).toBe(true)
	})
	test('examples must behave', () => {
		const errors = validateRule(
			{
				...ok,
				examples: { hit: ['git checkout main'], miss: ['git checkout -b b'] },
			},
			vars,
			CHECKS
		)
		expect(errors).toContain('ตัวอย่าง hit ไม่โดนกฎ: git checkout main')
		expect(errors).toContain('ตัวอย่าง miss โดนกฎ: git checkout -b b')
	})
	test('rewrite may not add shell operators', () => {
		const errors = validateRule({ ...ok, rewrite: '$1 && rm -rf /' }, vars, CHECKS)
		expect(errors.some((e) => e.includes('&&'))).toBe(true)
	})
	test('rewrite must be idempotent', () => {
		const loop: Rule = {
			...ok,
			match: 'git push',
			rewrite: '$& --force-with-lease',
			examples: { hit: ['git push'], miss: [] },
		}
		expect(validateRule(loop, vars, CHECKS).some((e) => e.includes('idempotent'))).toBe(true)
	})
	test('rewrite needs a template, check must be known, match xor check rules', () => {
		expect(validateRule({ ...ok, rewrite: undefined }, vars, CHECKS)).toContain('action rewrite ต้องมี rewrite')
		expect(
			validateRule(
				{
					...ok,
					check: 'nope',
					match: undefined,
					examples: { hit: [], miss: [] },
				},
				vars,
				CHECKS
			)
		).toContain('ไม่รู้จัก check "nope"')
		expect(validateRule({ ...ok, check: 'secret', action: 'rewrite' }, vars, CHECKS)).toContain(
			'กฎที่ใช้ check ใช้ action rewrite ไม่ได้'
		)
		expect(validateRule({ ...ok, match: undefined, check: undefined }, vars, CHECKS)).toContain(
			'ต้องมี match หรือ check'
		)
	})
})
