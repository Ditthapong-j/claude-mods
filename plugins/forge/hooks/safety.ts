import { judge } from './match'
import type { Rule, Vars } from './types'

function compiles(source: string, flags: string | undefined): string | undefined {
	try {
		new RegExp(source, flags)
		return undefined
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
}

export function validateRule(rule: Rule, vars: Vars, knownChecks: ReadonlySet<string>): string[] {
	const errors: string[] = []
	if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(rule.id)) errors.push(`id "${rule.id}" ต้องเป็น kebab-case 2-41 ตัว`)
	if (rule.tools.length === 0) errors.push('tools ต้องมีอย่างน้อย 1 ตัว')
	if (rule.why.trim() === '') errors.push('why ต้องไม่ว่าง')
	if (rule.match === undefined && rule.check === undefined) errors.push('ต้องมี match หรือ check')
	if (rule.check !== undefined && !knownChecks.has(rule.check)) errors.push(`ไม่รู้จัก check "${rule.check}"`)
	if (rule.check !== undefined && rule.action === 'rewrite') errors.push('กฎที่ใช้ check ใช้ action rewrite ไม่ได้')
	if (rule.action === 'rewrite' && rule.rewrite === undefined) errors.push('action rewrite ต้องมี rewrite')
	if (rule.action === 'rewrite' && rule.check === undefined) {
		if (rule.examples.hit.length === 0) errors.push('rule rewrite ต้องมีตัวอย่าง hit อย่างน้อย 1 ตัว')
		if (rule.field !== 'command') errors.push('rule rewrite แก้ได้เฉพาะ field command')
		if (rule.segments === true) errors.push('rule rewrite ใช้ segments ไม่ได้')
	}
	for (const [name, source] of [
		['match', rule.match],
		['unless', rule.unless],
	] as const) {
		if (source === undefined) continue
		const problem = compiles(source, rule.flags?.replace(/g/g, ''))
		if (problem !== undefined) errors.push(`${name} ไม่ใช่ regex ที่ใช้ได้: ${problem}`)
	}
	if (errors.length > 0 || rule.check !== undefined) return errors

	for (const hit of rule.examples.hit) {
		const verdict = judge(rule, hit, vars)
		if (verdict.kind === 'pass') {
			errors.push(`ตัวอย่าง hit ไม่โดนกฎ: ${hit}`)
			continue
		}
		if (rule.action === 'rewrite' && verdict.kind === 'deny') {
			errors.push(`rewrite เพิ่ม operator ที่ไม่มีในคำสั่งเดิม: ${verdict.message}`)
			continue
		}
		if (verdict.kind !== 'rewrite') continue
		if (judge(rule, verdict.value, vars).kind !== 'pass')
			errors.push(`rewrite ไม่ idempotent: ${verdict.value} ยังโดนกฎซ้ำ`)
	}
	for (const miss of rule.examples.miss) {
		if (judge(rule, miss, vars).kind !== 'pass') errors.push(`ตัวอย่าง miss โดนกฎ: ${miss}`)
	}
	return errors
}
