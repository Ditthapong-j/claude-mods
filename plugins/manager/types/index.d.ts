export type PluginRowState = {
	name: string
	version: string | null
	provenance: string
	root: string
	isSuite: boolean
}

declare module 'claude-code' {
	interface PluginState {
		manager: {
			plugins: PluginRowState[]
			view: {
				plugins: PluginRowState[]
				rules: { rules: { id: string; source: string; enabled: boolean; hits30: number }[]; errors: string[] } | { error: string }
				proof: string
			} | null
		}
	}
}
