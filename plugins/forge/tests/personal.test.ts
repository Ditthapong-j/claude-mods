import { describe, expect, test } from 'claude-code/testing'

import { withRule } from '../hooks/guards-file'
import { personalFor, remove, setEnabled, upsert } from '../hooks/personal'
import type { PersonalRule } from '../hooks/personal'
import type { Rule } from '../hooks/types'

const rule = (id: string): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why: 'w',
	examples: { hit: [], miss: [] },
	enabled: true,
})
const item = (id: string, root?: string): PersonalRule => ({
	rule: rule(id),
	scope: root === undefined ? { kind: 'any-repo' } : { kind: 'repo', root },
	createdAt: 0,
	lesson: 'l',
})

describe('personal rules', () => {
	test('split by scope for the current repo', () => {
		const out = personalFor([item('a'), item('b', '/r'), item('c', '/other')], '/r')
		expect(out.repo.map((r) => r.id)).toEqual(['b'])
		expect(out.any.map((r) => r.id)).toEqual(['a'])
		expect(personalFor([item('b', '/r')], null).repo).toEqual([])
	})
	test('upsert replaces by id, setEnabled and remove', () => {
		const list = upsert([item('a')], { ...item('a'), lesson: 'new' })
		expect(list.length).toBe(1)
		expect(list[0]?.lesson).toBe('new')
		expect(setEnabled(list, 'a', false)[0]?.rule.enabled).toBe(false)
		expect(remove(list, 'a')).toEqual([])
	})
})

describe('withRule', () => {
	test('creates, appends and replaces rules in guards.json text', () => {
		const created = withRule(null, rule('a'))
		if (!('text' in created)) throw new Error(created.error)
		expect(JSON.parse(created.text)).toEqual({
			rules: [
				{
					id: 'a',
					tool: 'Bash',
					field: 'command',
					match: 'x',
					action: 'deny',
					why: 'w',
					examples: { hit: [], miss: [] },
				},
			],
		})
		const appended = withRule(
			'{"vars":{"baseBranch":"origin/main"},"rules":[{"id":"z","tool":"Bash","match":"y","action":"warn","why":"v"}]}',
			rule('a')
		)
		if (!('text' in appended)) throw new Error(appended.error)
		const parsed = JSON.parse(appended.text) as { vars: unknown; rules: { id: string }[] }
		expect(parsed.vars).toEqual({ baseBranch: 'origin/main' })
		expect(parsed.rules.map((r) => r.id)).toEqual(['z', 'a'])
		const replaced = withRule(appended.text, { ...rule('a'), why: 'ใหม่' })
		if (!('text' in replaced)) throw new Error(replaced.error)
		expect((JSON.parse(replaced.text) as { rules: { why: string }[] }).rules[1]?.why).toBe('ใหม่')
	})
	test('broken JSON is an error, not an overwrite', () => {
		expect('error' in withRule('{ nope', rule('a'))).toBe(true)
	})
})
