export type ShipState = {
	issue: string
	baseBranch: string
	branch: string | null
	step: 'understand' | 'worktree' | 'red-test' | 'fix' | 'proof' | 'review' | 'open-pr'
	attempts: number
	status: 'running' | 'waiting-person' | 'blocked' | 'done' | 'stopped'
	log: string[]
	reviewer: string
	stepStartedAt: number
	pushApproved: boolean
	ours: boolean
	reviewPhase: 'reviewing' | 'fixing' | null
	awaitingProof: boolean
}

declare module 'claude-code' {
	interface PluginState {
		autopilot: { ship: ShipState | null; reviewAgent: string | null }
	}
}
