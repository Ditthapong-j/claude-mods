import { describe, expect, test } from 'claude-code/testing'

import { mergeRules } from '../hooks/engine'
import type { Rule } from '../hooks/types'

const rule = (id: string, why: string): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why,
	examples: { hit: [], miss: [] },
	enabled: true,
})

describe('mergeRules', () => {
	test('the first source wins on a duplicate id', () => {
		const merged = mergeRules([rule('a', 'repo')], [rule('a', 'builtin'), rule('b', 'builtin')])
		expect(merged.map((r) => `${r.id}:${r.why}`)).toEqual(['a:repo', 'b:builtin'])
	})
})
