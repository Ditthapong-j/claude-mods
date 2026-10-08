import type { Rule } from './types'

export function ruleToJson(rule: Rule): Record<string, unknown> {
	const { tools, enabled, ...rest } = rule
	const out: Record<string, unknown> = tools.length === 1 ? { id: rest.id, tool: tools[0] } : { id: rest.id, tools }
	for (const [key, value] of Object.entries(rest)) {
		if (key !== 'id' && value !== undefined) out[key] = value
	}
	if (!enabled) out['enabled'] = false
	return out
}

export function withRule(text: string | null, rule: Rule): { text: string } | { error: string } {
	let raw: unknown = {}
	if (text !== null && text.trim() !== '') {
		try {
			raw = JSON.parse(text)
		} catch (err) {
			return {
				error: `.claude/guards.json ไม่ใช่ JSON ที่ถูกต้อง จึงไม่เขียนทับ: ${err instanceof Error ? err.message : String(err)}`,
			}
		}
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		return { error: '.claude/guards.json ต้องเป็น object' }
	const doc = raw as Record<string, unknown>
	const rules = Array.isArray(doc['rules']) ? (doc['rules'] as unknown[]) : []
	const others = rules.filter(
		(r) => !(typeof r === 'object' && r !== null && (r as Record<string, unknown>)['id'] === rule.id)
	)
	const next = { ...doc, rules: [...others, ruleToJson(rule)] }
	return { text: `${JSON.stringify(next, null, '\t')}\n` }
}
