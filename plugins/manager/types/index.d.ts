export type PluginRowState = {
	name: string
	version: string | null
	provenance: string
	root: string
	isSuite: boolean
}

declare module 'claude-code' {
	interface PluginState {
		manager: { plugins: PluginRowState[] }
	}
}
