import type { HitRecord } from '../types'
import type { Rule } from './types'

export type GuardsInput = {
	args: string
	originKind: string
	rules: readonly Rule[]
	hits: readonly HitRecord[]
	errors: readonly string[]
	root: string | null
}

export type GuardsAction = { text: string; allow?: string }

function summary(input: GuardsInput): string {
	const count = new Map<string, number>()
	for (const h of input.hits) count.set(h.ruleId, (count.get(h.ruleId) ?? 0) + 1)
	const lines = [`forge · repo: ${input.root ?? '(ไม่อยู่ใน git repo)'} · กฎ ${input.rules.length} ข้อ`]
	for (const r of input.rules) {
		const n = count.get(r.id) ?? 0
		lines.push(
			`  ${r.enabled ? '●' : '○'} ${r.id} (${r.action}${r.check === undefined ? '' : ` · ${r.check}`})${n > 0 ? ` · ดักไป ${n} ครั้ง` : ''}`
		)
	}
	const recent = input.hits.slice(-5)
	if (recent.length > 0) {
		lines.push('ล่าสุด:')
		for (const h of recent) lines.push(`  ${h.kind} ${h.ruleId}: ${h.summary.slice(0, 100)}`)
	}
	if (input.errors.length > 0) {
		lines.push('ปัญหาใน .claude/guards.json:')
		for (const e of input.errors) lines.push(`  ${e}`)
	}
	lines.push('ยกเว้นกฎครั้งเดียว: /guards allow <id>')
	return lines.join('\n')
}

export function handleGuardsCommand(input: GuardsInput): GuardsAction {
	const [verb, id] = input.args.trim().split(/\s+/)
	if (verb !== 'allow') return { text: summary(input) }
	if (input.originKind !== 'composer') return { text: 'ผู้ใช้ต้องพิมพ์เองที่ช่องพิมพ์ ยกเว้นกฎแทนผู้ใช้ไม่ได้' }
	if (id === undefined || !input.rules.some((r) => r.id === id))
		return {
			text: `ไม่มีกฎ ${id ?? '(ไม่ได้ระบุ)'} · พิมพ์ /guards เพื่อดูรายชื่อ`,
		}
	return {
		text: `ยกเว้นกฎ ${id} ได้ 1 ครั้ง (ครั้งถัดไปที่กฎนี้จะทำงาน)`,
		allow: id,
	}
}
