export type HitRecord = {
	ruleId: string
	tool: string
	kind: 'deny' | 'rewrite' | 'warn'
	at: number
	summary: string
}

declare module 'claude-code' {
	interface PluginState {
		forge: { allowOnce: string[]; hits: HitRecord[]; warned: string[] }
	}
}
