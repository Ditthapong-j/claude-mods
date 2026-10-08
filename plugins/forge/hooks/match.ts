import { globToRegExp } from './glob'
import type { Rule, ToolInput, Vars, Verdict } from './types'

export const PASS: Verdict = { kind: 'pass' }

export function interpolate(template: string, vars: Vars): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

function regex(source: string, flags: string | undefined): RegExp {
	return new RegExp(source, (flags ?? '').replace(/g/g, ''))
}

function relative(filePath: string, root: string | undefined): string {
	return root !== undefined && filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath
}

export function applies(rule: Rule, tool: string, input: ToolInput, vars: Vars): boolean {
	if (!rule.enabled || !rule.tools.includes(tool)) return false
	if (rule.requires?.some((key) => vars[key] === undefined)) return false
	if (rule.paths === undefined && rule.exceptPaths === undefined) return true
	const filePath = input['file_path']
	if (typeof filePath !== 'string') return rule.paths === undefined
	const rel = relative(filePath, vars['repoRoot'])
	if (rule.exceptPaths?.some((glob) => globToRegExp(glob).test(rel))) return false
	return rule.paths === undefined || rule.paths.some((glob) => globToRegExp(glob).test(rel))
}

export function triggers(rule: Rule, value: string): boolean {
	if (rule.match === undefined) return true
	if (!regex(rule.match, rule.flags).test(value)) return false
	return rule.unless === undefined || !regex(rule.unless, rule.flags).test(value)
}

export function judge(rule: Rule, value: string, vars: Vars): Verdict {
	if (rule.check !== undefined || rule.match === undefined || !triggers(rule, value)) return PASS
	const why = rule.hint === undefined ? rule.why : `${rule.why} · ${interpolate(rule.hint, vars)}`
	if (rule.action === 'deny') return { kind: 'deny', ruleId: rule.id, message: why }
	if (rule.action === 'warn') return { kind: 'warn', ruleId: rule.id, message: why }
	const next = value.replace(regex(rule.match, rule.flags), interpolate(rule.rewrite ?? '$&', vars))
	if (next === value) return PASS
	return {
		kind: 'rewrite',
		ruleId: rule.id,
		value: next,
		note: `แก้คำสั่งเป็น: ${next} (${rule.id} · ${rule.why})`,
	}
}
