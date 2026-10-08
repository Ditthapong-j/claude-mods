export type DevkitStatus = { branch: string | null; behind: number | null; dirty: number | null; ctxPercent: number | null }

export type RunningCommand = { key: string; command: string; startedAt: number; knownSlow: boolean; warning: string | null }

export type DiskState = { freeGb: number | null; containers: string[] }

declare module 'claude-code' {
	interface PluginState {
		devkit: {
			status: DevkitStatus
			lastBranch: string | null
			claudeSwitchAt: number
			running: Record<string, RunningCommand>
			disk: DiskState | null
			diskHidden: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
