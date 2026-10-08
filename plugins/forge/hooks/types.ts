export type Action = 'deny' | 'rewrite' | 'warn'

export type Vars = Readonly<Record<string, string>>

export type ToolInput = Readonly<Record<string, unknown>>

export type Rule = {
	id: string
	tools: readonly string[]
	field: string
	match?: string
	flags?: string
	unless?: string
	paths?: readonly string[]
	exceptPaths?: readonly string[]
	requires?: readonly string[]
	check?: string
	params?: Readonly<Record<string, unknown>>
	action: Action
	rewrite?: string
	why: string
	hint?: string
	examples: { hit: readonly string[]; miss: readonly string[] }
	enabled: boolean
}

export type Verdict =
	| { kind: 'pass' }
	| { kind: 'deny'; ruleId: string; message: string }
	| { kind: 'rewrite'; ruleId: string; value: string; note: string }
	| { kind: 'warn'; ruleId: string; message: string }

export type RepoConfig = {
	root: string | null
	vars: Vars
	rules: readonly Rule[]
	errors: readonly string[]
}
