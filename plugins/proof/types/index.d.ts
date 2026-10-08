export type ProofResultState = {
	id: string
	label: string
	status: 'running' | 'pass' | 'fail' | 'flaky'
	exitCode: number | null
	tail: string
	at: number
	durationMs: number
}

declare module 'claude-code' {
	interface PluginState {
		proof: {
			touched: string[]
			results: ProofResultState[]
			bandHidden: boolean
			enabled: boolean
			busy: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
