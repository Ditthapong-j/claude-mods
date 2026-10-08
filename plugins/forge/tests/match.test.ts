import { describe, expect, test } from 'claude-code/testing'

import { globToRegExp } from '../hooks/glob'
import { applies, interpolate, judge, triggers } from '../hooks/match'
import type { Rule } from '../hooks/types'

const base: Rule = {
	id: 'demo',
	tools: ['Bash'],
	field: 'command',
	match: '^(\\s*git\\s+checkout\\s+-b\\s+\\S+)\\s*$',
	action: 'rewrite',
	rewrite: '$1 {baseBranch}',
	why: 'แตก branch จากฐานที่ถูก',
	examples: { hit: [], miss: [] },
	enabled: true,
}

describe('globToRegExp', () => {
	test('** crosses folders, * does not', () => {
		expect(globToRegExp('apps/web/**').test('apps/web/src/a.tsx')).toBe(true)
		expect(globToRegExp('apps/*.ts').test('apps/x/y.ts')).toBe(false)
		expect(globToRegExp('**/*.example*').test('config/app.example.json')).toBe(true)
		expect(globToRegExp('**/*.example*').test('app.example')).toBe(true)
	})
})

describe('interpolate', () => {
	test('fills known vars and keeps unknown ones', () => {
		expect(interpolate('$1 {baseBranch} {nope}', { baseBranch: 'origin/main' })).toBe('$1 origin/main {nope}')
	})
})

describe('judge', () => {
	test('rewrite appends the base branch', () => {
		const v = judge(base, 'git checkout -b fix/a', {
			baseBranch: 'origin/develop',
		})
		expect(v).toEqual({
			kind: 'rewrite',
			ruleId: 'demo',
			value: 'git checkout -b fix/a origin/develop',
			note: 'แก้คำสั่งเป็น: git checkout -b fix/a origin/develop (demo · แตก branch จากฐานที่ถูก)',
		})
	})
	test('rewrite that changes nothing passes', () => {
		expect(judge(base, 'git checkout main', { baseBranch: 'origin/develop' })).toEqual({ kind: 'pass' })
	})
	test('unless exempts', () => {
		const rule: Rule = {
			...base,
			action: 'deny',
			rewrite: undefined,
			match: 'git stash',
			unless: '-m ',
		}
		expect(judge(rule, 'git stash push -m "x"', {}).kind).toBe('pass')
		expect(judge(rule, 'git stash', {})).toEqual({
			kind: 'deny',
			ruleId: 'demo',
			message: 'แตก branch จากฐานที่ถูก',
		})
	})
	test('deny message adds the hint with vars', () => {
		const rule: Rule = {
			...base,
			action: 'deny',
			match: 'x',
			hint: 'ใช้ {baseBranch}',
		}
		expect(judge(rule, 'x', { baseBranch: 'origin/main' })).toEqual({
			kind: 'deny',
			ruleId: 'demo',
			message: 'แตก branch จากฐานที่ถูก · ใช้ origin/main',
		})
	})
	test('a g flag does not make matching stateful', () => {
		const rule: Rule = {
			...base,
			action: 'warn',
			match: 'Acme App',
			flags: 'gi',
		}
		expect(judge(rule, 'acme app', {}).kind).toBe('warn')
		expect(judge(rule, 'acme app', {}).kind).toBe('warn')
	})
})

describe('applies', () => {
	test('checks tool, enabled, requires and paths', () => {
		expect(applies(base, 'Bash', { command: 'x' }, { baseBranch: 'b' })).toBe(true)
		expect(applies(base, 'Edit', { command: 'x' }, { baseBranch: 'b' })).toBe(false)
		expect(applies({ ...base, enabled: false }, 'Bash', { command: 'x' }, {})).toBe(false)
		expect(applies({ ...base, requires: ['baseBranch'] }, 'Bash', { command: 'x' }, {})).toBe(false)
		const edit: Rule = {
			...base,
			tools: ['Edit'],
			field: 'new_string',
			paths: ['apps/web/**'],
			exceptPaths: ['**/*.test.tsx'],
		}
		const vars = { repoRoot: '/r' }
		expect(applies(edit, 'Edit', { file_path: '/r/apps/web/a.tsx', new_string: 'x' }, vars)).toBe(true)
		expect(applies(edit, 'Edit', { file_path: '/r/apps/web/a.test.tsx', new_string: 'x' }, vars)).toBe(false)
		expect(applies(edit, 'Edit', { file_path: '/r/backend/a.cs', new_string: 'x' }, vars)).toBe(false)
	})
})

describe('triggers', () => {
	test('a check rule without match always triggers', () => {
		expect(triggers({ ...base, match: undefined, check: 'secret' }, 'anything')).toBe(true)
		expect(triggers({ ...base, check: 'secret', match: 'vitest' }, 'npm test')).toBe(false)
	})
})
