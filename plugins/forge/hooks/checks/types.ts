import type { Rule, ToolInput, Vars, Verdict } from '../types'

// check เป็น pure: ขอข้อมูลภายนอกผ่าน probe แล้ว register.ts เป็นคนเรียก $ ให้
// (engine ไม่ยอมให้ส่ง $ เข้าฟังก์ชันที่ import มาจากไฟล์อื่น)
export type Probe =
	| { kind: 'run'; argv: readonly string[]; cwd?: string }
	| { kind: 'read'; path: string }
	| { kind: 'fetch'; url: string }

export type ProbeResult =
	| { kind: 'run'; exitCode: number; stdout: string; stderr: string }
	| { kind: 'read'; text: string | null }
	| { kind: 'fetch'; status: number; ok: boolean; text: string }
	| { kind: 'error'; message: string }

export type Step = Verdict | { probes: readonly Probe[]; next: (results: readonly ProbeResult[]) => Step }

export type CheckContext = { rule: Rule; tool: string; value: string; input: ToolInput; vars: Vars }

export type Check = {
	start(ctx: CheckContext): Step
	validate(params: unknown): string[]
}

export function isVerdict(step: Step): step is Verdict {
	return 'kind' in step
}
