import { describe, expect, test } from 'claude-code/testing'

import { parseLessonsArgs, ruleRows } from '../hooks/rules-view'
import type { Rule } from '../hooks/types'

const r = (id: string, enabled = true): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why: 'w',
	examples: { hit: [], miss: [] },
	enabled,
})
const DAY = 86_400_000

describe('ruleRows', () => {
	test('labels each source and counts hits in the last 30 days', () => {
		const rows = ruleRows(
			{ repo: [r('a')], personalRepo: [r('b')], personal: [r('c', false)], builtin: [r('d')] },
			[
				{ ruleId: 'a', at: 40 * DAY },
				{ ruleId: 'a', at: 5 * DAY },
				{ ruleId: 'd', at: 39 * DAY },
			],
			40 * DAY
		)
		expect(rows.map((x) => `${x.id}:${x.source}:${x.enabled}:${x.hits30}`)).toEqual([
			'a:repo:true:1',
			'b:personal-repo:true:0',
			'c:personal:false:0',
			'd:builtin:true:1',
		])
	})
})

describe('parseLessonsArgs', () => {
	const person = { kind: 'composer' }
	test('person may change rules', () => {
		expect(parseLessonsArgs('', person)).toEqual({ kind: 'open' })
		expect(parseLessonsArgs('accept repo', person)).toEqual({ kind: 'accept', scope: 'repo' })
		expect(parseLessonsArgs('disable named-stash', person)).toEqual({ kind: 'set', id: 'named-stash', enabled: false })
		expect(parseLessonsArgs('import-memory /x/memory', person)).toEqual({ kind: 'import', dir: '/x/memory' })
	})
	test('the manager plugin may toggle but not accept', () => {
		const manager = { kind: 'plugin', name: 'manager' }
		expect(parseLessonsArgs('disable a', manager)).toEqual({ kind: 'set', id: 'a', enabled: false })
		expect(parseLessonsArgs('accept any-repo', manager).kind).toBe('refused')
	})
	test('anyone else is refused for changes but may open', () => {
		for (const origin of [{ kind: 'sdk' }, { kind: 'plugin', name: 'other' }, { kind: 'peer' }]) {
			expect(parseLessonsArgs('disable a', origin).kind).toBe('refused')
			expect(parseLessonsArgs('accept file', origin).kind).toBe('refused')
			expect(parseLessonsArgs('', origin)).toEqual({ kind: 'open' })
		}
	})
	test('unknown verbs explain usage', () => {
		expect(parseLessonsArgs('nope', person).kind).toBe('help')
	})
})
