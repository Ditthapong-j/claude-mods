import { PASS } from '../match'
import type { Check } from './types'

export const vitestConcurrent: Check = {
	start({ rule }) {
		return {
			probes: [{ kind: 'run', argv: ['pgrep', '-f', 'vitest'] }],
			next: ([res]) => {
				if (res?.kind !== 'run' || res.exitCode !== 0) return PASS
				const pids = res.stdout.trim().split('\n').filter(Boolean)
				if (pids.length === 0) return PASS
				return {
					kind: 'deny',
					ruleId: rule.id,
					message: `vitest อีกตัวยังรันอยู่ (pid ${pids.join(', ')}) รันซ้อนแล้วเคสที่ใช้เวลานานจะ timeout · รอให้จบก่อน หรือถ้าเป็น watch ของ editor ให้ผู้ใช้พิมพ์ /guards allow ${rule.id}`,
				}
			},
		}
	},
	validate: () => [],
}
