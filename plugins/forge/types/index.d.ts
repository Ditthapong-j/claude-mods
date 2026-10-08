export type HitRecord = { ruleId: string; tool: string; kind: 'deny' | 'rewrite' | 'warn'; at: number; summary: string }

export type RecentCallState = { tool: string; summary: string }

export type DraftState = { rule: Record<string, unknown>; lesson: string }

export type ErrorRecord = { at: number; where: string; message: string }

declare module 'claude-code' {
	interface PluginState {
		forge: {
			allowOnce: string[]
			hits: HitRecord[]
			warned: string[]
			draft: DraftState | null
			pending: { text: string; calls: RecentCallState[] } | null
			recent: RecentCallState[]
			history: string[]
			importQueue: DraftState[]
			errors: ErrorRecord[]
		}
	}
}
