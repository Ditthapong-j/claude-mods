import { PASS } from '../match'
import type { Check } from './types'

// host ของเครื่อง dev: รหัสผ่านใน connection string ไปที่ host พวกนี้เป็นค่าตัวอย่างของ local dev
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal'])

// (label, pattern, host ของ connection string ถ้ามี)
const PATTERNS: ReadonlyArray<readonly [string, RegExp, boolean]> = [
	['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, false],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g, false],
	['API key แบบ sk-', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, false],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, false],
	['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, false],
	[
		'connection string ที่มีรหัสผ่าน',
		/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^:\s/]+:(?![$<{%*])[^@\s]{3,}@([^\s/:?,"']+)/g,
		true,
	],
	['รหัสผ่านใน connection string', /\b(?:Password|Pwd)=(?![$<{%*])[^;"'\s]{4,}/gi, false],
]

export const secret: Check = {
	start({ rule, value, input }) {
		// Edit ที่ย้ายบรรทัดเดิม (มีอยู่แล้วใน old_string) ไม่ได้เพิ่ม secret ใหม่
		const before = typeof input['old_string'] === 'string' ? input['old_string'] : ''
		for (const [label, pattern, hasHost] of PATTERNS) {
			for (const m of value.matchAll(pattern)) {
				if (before.includes(m[0])) continue
				if (hasHost && LOCAL_HOSTS.has((m[1] ?? '').toLowerCase())) continue
				return {
					kind: 'deny',
					ruleId: rule.id,
					message: `พบ ${label} ในเนื้อหาที่จะเขียน ให้เก็บใน secret store (Key Vault, user-secrets หรือ .env ที่ไม่ commit) แล้วอ้างผ่าน config`,
				}
			}
		}
		return PASS
	},
	validate: () => [],
}
