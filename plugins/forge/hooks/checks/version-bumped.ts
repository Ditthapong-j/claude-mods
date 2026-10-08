import { PASS } from '../match'
import type { Check } from './types'

type Params = { versionFile: string; versionUrl: string; field: string }

function parse(params: unknown): Params | undefined {
	if (typeof params !== 'object' || params === null) return undefined
	const p = params as Record<string, unknown>
	const versionFile = p['versionFile']
	const versionUrl = p['versionUrl']
	if (typeof versionFile !== 'string' || typeof versionUrl !== 'string') return undefined
	return { versionFile, versionUrl, field: typeof p['field'] === 'string' ? p['field'] : 'version' }
}

function runningVersion(text: string, field: string): unknown {
	try {
		const body: unknown = JSON.parse(text)
		return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined
	} catch {
		return undefined
	}
}

export const versionBumped: Check = {
	start({ rule, vars }) {
		const params = parse(rule.params)
		const root = vars['repoRoot']
		if (params === undefined || root === undefined) {
			return { kind: 'deny', ruleId: rule.id, message: 'ตั้งค่า version-bumped ไม่ครบ' }
		}
		const allow = `ถ้าแน่ใจ ให้ผู้ใช้พิมพ์ /guards allow ${rule.id}`
		return {
			probes: [
				{ kind: 'read', path: `${root}/${params.versionFile}` },
				{ kind: 'fetch', url: params.versionUrl },
			],
			next: ([file, res]) => {
				const local = file?.kind === 'read' && file.text !== null ? file.text.trim() : ''
				if (res?.kind === 'error') {
					return { kind: 'deny', ruleId: rule.id, message: `ถาม version ที่รันอยู่ไม่ได้ (${res.message}) · ${allow}` }
				}
				if (res?.kind !== 'fetch' || !res.ok) {
					const status = res?.kind === 'fetch' ? res.status : 'ไม่มีผล'
					return {
						kind: 'deny',
						ruleId: rule.id,
						message: `ถาม version ที่รันอยู่ไม่ได้ (HTTP ${status} จาก ${params.versionUrl}) · ${allow}`,
					}
				}
				const running = runningVersion(res.text, params.field)
				if (typeof running !== 'string') {
					return { kind: 'deny', ruleId: rule.id, message: `${params.versionUrl} ไม่มี field "${params.field}" · ${allow}` }
				}
				if (local !== running) return PASS
				return {
					kind: 'deny',
					ruleId: rule.id,
					message: `${params.versionFile} = ${local} เท่ากับที่รันอยู่ ต้อง bump ก่อน deploy · ถามผู้ใช้ว่า patch, minor หรือ major`,
				}
			},
		}
	},
	validate(params) {
		const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
		const errors: string[] = []
		if (typeof p['versionFile'] !== 'string') errors.push('params.versionFile ต้องเป็นข้อความ')
		const url = p['versionUrl']
		if (typeof url !== 'string' || !url.startsWith('https://')) errors.push('params.versionUrl ต้องเป็น https URL')
		return errors
	},
}
