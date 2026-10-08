export type MissionSnapshot = {
	at: number
	worktrees: { path: string; branch: string | null; dirty: number }[]
	worktreeError: string | null
	prs: { number: number; title: string; branch: string; checks: string; review: string }[] | { error: string }
	peers: { name: string; id: string; kind: string; state: string }[] | { error: string }
	envs: { name: string; version: string | null; commit: string | null; problem: string | null }[]
	waiting: string[]
}

declare module 'claude-code' {
	interface PluginState {
		mission: {
			snapshot: MissionSnapshot | null
			open: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
