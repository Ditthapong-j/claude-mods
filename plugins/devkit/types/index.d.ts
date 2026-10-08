export type DevkitStatus = { branch: string | null; behind: number | null; dirty: number | null; ctxPercent: number | null }

export type RunningCommand = { key: string; command: string; startedAt: number; knownSlow: boolean }

export type DiskState = { freeGb: number | null; containers: string[] }

declare module 'claude-code' {
	interface PluginState {
		devkit: {
			status: DevkitStatus
			lastBranch: string | null
			claudeSwitchAt: number
			running: RunningCommand | null
			longRunWarning: string | null
			disk: DiskState | null
			diskHidden: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
