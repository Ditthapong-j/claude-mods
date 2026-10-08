import { describe, expect, test } from 'claude-code/testing'

import { BUILTIN_RULES } from '../hooks/builtin'
import { CHECK_NAMES } from '../hooks/checks/index'
import { judge } from '../hooks/match'
import { validateRule } from '../hooks/safety'

const vars = { baseBranch: 'origin/develop', repoRoot: '/r' }
const rule = (id: string) => {
	const found = BUILTIN_RULES.find((r) => r.id === id)
	if (found === undefined) throw new Error(`missing ${id}`)
	return found
}

describe('builtin rules', () => {
	test('every builtin rule validates', () => {
		for (const r of BUILTIN_RULES) expect(validateRule(r, vars, CHECK_NAMES)).toEqual([])
	})

	test('named-stash catches bare stash anywhere in a chain', () => {
		const r = rule('named-stash')
		for (const cmd of [
			'git stash',
			'git stash pop',
			'git stash push -u',
			'cd apps/web && git stash',
			'FOO=1 git stash',
		]) {
			expect(judge(r, cmd, vars).kind).toBe('deny')
		}
		for (const cmd of [
			'git stash push -u -m "wip-x"',
			'git stash list',
			'git stash apply 3f2a1b',
			'git status',
			'git stash drop stash@{2}',
		]) {
			expect(judge(r, cmd, vars).kind).toBe('pass')
		}
	})

	test('branch-base appends the base once', () => {
		const r = rule('branch-base')
		expect(judge(r, 'git checkout -b fix/a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'git checkout -b fix/a origin/develop',
		})
		expect(judge(r, 'git switch -c fix/a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'git switch -c fix/a origin/develop',
		})
		expect(judge(r, 'git checkout -b fix/a origin/develop', vars).kind).toBe('pass')
		expect(judge(r, 'git checkout -b fix/a main', vars).kind).toBe('pass')
	})
})
