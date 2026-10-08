import { PASS } from '../match'
import type { Check } from './types'

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
	['API key แบบ sk-', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
	['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
	[
		'connection string ที่มีรหัสผ่าน',
		/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^:\s/]+:(?![$<{%])[^@\s]{3,}@/,
	],
	['รหัสผ่านใน connection string', /\b(?:Password|Pwd)=(?![$<{%])[^;"'\s]{4,}/i],
]

export const secret: Check = {
	start({ rule, value }) {
		for (const [label, pattern] of PATTERNS) {
			if (pattern.test(value)) {
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
