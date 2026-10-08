import type { HitRecord } from '../types'
import { CHECKS } from './checks/index'
import type { Step } from './checks/types'
import { applies, judge, PASS, triggers } from './match'
import type { Rule, ToolInput, Vars, Verdict } from './types'

export type Outcome = {
	deny?: { ruleId: string; message: string }
	input: ToolInput
	notes: string[]
	warns: string[]
	hits: HitRecord[]
	consumed: string[]
}

export function mergeRules(...sources: readonly (readonly Rule[])[]): Rule[] {
	const seen = new Set<string>()
	const out: Rule[] = []
	for (const source of sources) {
		for (const rule of source) {
			if (seen.has(rule.id)) continue
			seen.add(rule.id)
			out.push(rule)
		}
	}
	return out
}

export function newOutcome(input: ToolInput): Outcome {
	return { input, notes: [], warns: [], hits: [], consumed: [] }
}

// null = กฎนี้ไม่เกี่ยวกับการเรียกนี้
export function startRule(rule: Rule, tool: string, input: ToolInput, vars: Vars): Step | null {
	if (!applies(rule, tool, input, vars)) return null
	const value = input[rule.field]
	if (typeof value !== 'string') return null
	if (rule.check === undefined) return judge(rule, value, vars)
	if (!triggers(rule, value)) return PASS
	const check = CHECKS[rule.check]
	if (check === undefined) return { kind: 'deny', ruleId: rule.id, message: `ไม่รู้จัก check "${rule.check}"` }
	return check.start({ rule, tool, value, input, vars })
}

// บันทึกผลของกฎหนึ่งข้อลง outcome; คืน 'stop' เมื่อถูก deny
export function record(
	out: Outcome,
	rule: Rule,
	verdict: Verdict,
	tool: string,
	allowed: ReadonlySet<string>,
	now: number
): 'stop' | 'go' {
	if (verdict.kind === 'pass') return 'go'
	if (allowed.has(rule.id) && !out.consumed.includes(rule.id)) {
		out.consumed.push(rule.id)
		out.notes.push(`ยกเว้นกฎ ${rule.id} ครั้งนี้ตามที่ผู้ใช้สั่ง (/guards allow)`)
		return 'go'
	}
	const summary = verdict.kind === 'rewrite' ? verdict.note : verdict.message
	out.hits.push({ ruleId: rule.id, tool, kind: verdict.kind, at: now, summary })
	if (verdict.kind === 'deny') {
		out.deny = { ruleId: rule.id, message: verdict.message }
		return 'stop'
	}
	if (verdict.kind === 'rewrite') {
		out.input = { ...out.input, [rule.field]: verdict.value }
		out.notes.push(verdict.note)
	} else {
		out.notes.push(`${rule.id}: ${verdict.message}`)
		out.warns.push(`${rule.id}: ${verdict.message}`)
	}
	return 'go'
}
