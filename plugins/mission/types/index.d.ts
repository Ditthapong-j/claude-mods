export type MissionSnapshot = {
	at: number
	worktrees: { path: string; branch: string | null; dirty: number }[]
	worktreeError: string | null
	here: string | null
	prs:
		| {
				number: number
				title: string
				branch: string
				checks: 'pass' | 'fail' | 'pending' | 'none'
				review: 'approved' | 'changes' | 'pending'
				checksPass: number
				checksTotal: number
				updatedAt: number | null
		  }[]
		| { error: string }
	peers: { name: string; id: string; kind: string; state: string }[] | { error: string }
	envs: { name: string; service: string | null; version: string | null; commit: string | null; problem: string | null }[]
	waiting: string[]
}

declare module 'claude-code' {
	interface PluginState {
		mission: {
			snapshot: MissionSnapshot | null
			open: boolean
			showAll: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
