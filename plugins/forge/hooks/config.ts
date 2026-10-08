import { validateRule } from './safety'
import type { Action, RepoConfig, Rule } from './types'

export const GUARDS_FILE = '.claude/guards.json'

type ParamsValidator = (check: string, params: unknown) => string[]

const ACTIONS: readonly Action[] = ['deny', 'rewrite', 'warn']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

export function toRule(raw: unknown, index: number): { rule?: Rule; error?: string } {
	if (!isRecord(raw)) return { error: `rules[${index}] ต้องเป็น object` }
	const id = optionalString(raw['id']) ?? `rules[${index}]`
	const tools = typeof raw['tool'] === 'string' ? [raw['tool']] : strings(raw['tools'])
	const action = ACTIONS.find((a) => a === raw['action'])
	const why = optionalString(raw['why'])
	if (tools === undefined) return { error: `กฎ ${id}: ต้องมี tool หรือ tools` }
	if (action === undefined) return { error: `กฎ ${id}: action ต้องเป็น deny, rewrite หรือ warn` }
	if (why === undefined) return { error: `กฎ ${id}: ต้องมี why` }
	const examples = isRecord(raw['examples']) ? raw['examples'] : {}
	return {
		rule: {
			id,
			tools,
			field: optionalString(raw['field']) ?? 'command',
			match: optionalString(raw['match']),
			flags: optionalString(raw['flags']),
			unless: optionalString(raw['unless']),
			segments: raw['segments'] === true ? true : undefined,
			paths: strings(raw['paths']),
			exceptPaths: strings(raw['exceptPaths']),
			requires: strings(raw['requires']),
			check: optionalString(raw['check']),
			params: isRecord(raw['params']) ? raw['params'] : undefined,
			action,
			rewrite: optionalString(raw['rewrite']),
			why,
			hint: optionalString(raw['hint']),
			examples: {
				hit: strings(examples['hit']) ?? [],
				miss: strings(examples['miss']) ?? [],
			},
			enabled: raw['enabled'] !== false,
		},
	}
}

export function parseGuards(
	raw: unknown,
	root: string,
	knownChecks: ReadonlySet<string>,
	validateParams: ParamsValidator
): RepoConfig {
	const errors: string[] = []
	if (!isRecord(raw))
		return {
			root,
			vars: { repoRoot: root },
			rules: [],
			errors: [`${GUARDS_FILE} ต้องเป็น object`],
		}

	const vars: Record<string, string> = {}
	if (isRecord(raw['vars'])) {
		for (const [key, value] of Object.entries(raw['vars'])) {
			if (typeof value !== 'string') errors.push(`vars.${key} ต้องเป็นข้อความ`)
			else if (/[;&|$`<>\n]/.test(value)) errors.push(`vars.${key} มีอักขระ shell ที่ไม่อนุญาต`)
			else vars[key] = value
		}
	}
	vars['repoRoot'] = root

	const rules: Rule[] = []
	const rawRules = raw['rules'] ?? []
	if (!Array.isArray(rawRules)) {
		errors.push('rules ต้องเป็น array')
	} else {
		rawRules.forEach((item, index) => {
			const { rule, error } = toRule(item, index)
			if (rule === undefined) {
				errors.push(error ?? `rules[${index}] ใช้ไม่ได้`)
				return
			}
			const problems = [
				...validateRule(rule, vars, knownChecks),
				...(rule.check === undefined ? [] : validateParams(rule.check, rule.params ?? {})),
			]
			if (problems.length > 0) errors.push(`กฎ ${rule.id}: ${problems.join(' · ')}`)
			else rules.push(rule)
		})
	}
	return { root, vars, rules, errors }
}

export function parseGuardsText(
	text: string | null,
	root: string,
	knownChecks: ReadonlySet<string>,
	validateParams: ParamsValidator
): RepoConfig {
	if (text === null) return { root, vars: { repoRoot: root }, rules: [], errors: [`${GUARDS_FILE} ไม่ใช่ไฟล์ข้อความ`] }
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		return { root, vars: { repoRoot: root }, rules: [], errors: [`${GUARDS_FILE} ไม่ใช่ JSON ที่ถูกต้อง: ${reason}`] }
	}
	return parseGuards(raw, root, knownChecks, validateParams)
}
