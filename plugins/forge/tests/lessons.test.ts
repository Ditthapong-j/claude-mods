import { describe, expect, test } from 'claude-code/testing'

import { draftPrompt, isLessonCandidate, parseDraft, tooBroad } from '../hooks/lessons'

const calls = [{ tool: 'Bash', summary: 'git checkout -b fix/a' }]

describe('isLessonCandidate', () => {
	test('needs a real sentence and a previous tool call', () => {
		expect(isLessonCandidate('อย่าแตกจาก branch ของ PR ที่ยังไม่ merge', calls)).toBe(true)
		expect(isLessonCandidate('ต่อ', calls)).toBe(false)
		expect(isLessonCandidate('อย่าแตกจาก branch ของ PR ที่ยังไม่ merge', [])).toBe(false)
	})
})

describe('draftPrompt', () => {
	test('carries the correction, the calls and the JSON contract', () => {
		const p = draftPrompt('อย่าแตกจาก branch ของ PR', calls)
		expect(p).toContain('อย่าแตกจาก branch ของ PR')
		expect(p).toContain('git checkout -b fix/a')
		expect(p).toContain('"examples"')
		expect(p).toContain('NO_RULE')
	})
})

describe('parseDraft', () => {
	test('takes the first JSON object out of the answer', () => {
		const answer =
			'นี่คือกฎ:\n```json\n{"id":"branch-base","tool":"Bash","match":"^git checkout -b \\\\S+$","action":"deny","why":"แตกจากฐาน","examples":{"hit":["git checkout -b a"],"miss":["git status"]}}\n```'
		const out = parseDraft(answer)
		expect('rule' in out ? out.rule.id : out.error).toBe('branch-base')
	})
	test('NO_RULE, no JSON and broken JSON are errors, not crashes', () => {
		expect(parseDraft('NO_RULE')).toEqual({ error: 'โมเดลบอกว่าบทเรียนนี้เป็นกฎเครื่องไม่ได้' })
		expect('error' in parseDraft('ไม่มีอะไร')).toBe(true)
		expect('error' in parseDraft('{ "id": ')).toBe(true)
		expect('error' in parseDraft('')).toBe(true)
	})
})

describe('tooBroad', () => {
	test('a rule that would have stopped commands that ran fine is too broad', () => {
		const out = parseDraft('{"id":"no-git","tool":"Bash","match":"^git","action":"deny","why":"x"}')
		if (!('rule' in out)) throw new Error(out.error)
		expect(tooBroad(out.rule, ['git status', 'npm test'], {})).toContain('git status')
		const narrow = parseDraft('{"id":"no-stash","tool":"Bash","match":"^git stash$","action":"deny","why":"x"}')
		if (!('rule' in narrow)) throw new Error(narrow.error)
		expect(tooBroad(narrow.rule, ['git status', 'npm test'], {})).toBeUndefined()
	})
})

describe('tooBroad ignores the mistake being taught', () => {
	test('the command named in examples.hit is not counted as a good command', () => {
		const out = parseDraft('{"id":"no-bare","tool":"Bash","match":"^git checkout -b \\\\S+$","action":"deny","why":"x","examples":{"hit":["git checkout -b fix/a"],"miss":["git status"]}}')
		if (!('rule' in out)) throw new Error(out.error)
		expect(tooBroad(out.rule, ['git checkout -b fix/a', 'git status'], {})).toBeUndefined()
		expect(tooBroad(out.rule, ['git checkout -b other'], {})).toContain('git checkout -b other')
	})
})
