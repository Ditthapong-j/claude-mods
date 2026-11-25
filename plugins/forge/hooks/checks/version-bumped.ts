import { PASS } from '../match'
import type { Check, CheckContext, ProbeResult, Step } from './types'

type Params = { versionFile: string; versionUrl: string; field: string; defaultRef: string }

function parse(params: unknown): Params | undefined {
	if (typeof params !== 'object' || params === null) return undefined
	const p = params as Record<string, unknown>
	const versionFile = p['versionFile']
	const versionUrl = p['versionUrl']
	if (typeof versionFile !== 'string' || typeof versionUrl !== 'string') return undefined
	return {
		versionFile,
		versionUrl,
		field: typeof p['field'] === 'string' ? p['field'] : 'version',
		defaultRef: typeof p['defaultRef'] === 'string' ? p['defaultRef'] : 'main',
	}
}

// ref ที่คำสั่งจะ deploy (--ref main / --ref=main) ไม่ใช่ branch ที่ checkout อยู่บนเครื่อง
export function deployRef(command: string, fallback: string): string {
	const m = /--ref[ =]["']?([^\s"';&|]+)/.exec(command)
	return (m?.[1] ?? fallback).replace(/^origin\//, '').replace(/^refs\/heads\//, '')
}

function runningVersion(text: string, field: string): unknown {
	try {
		const body: unknown = JSON.parse(text)
		return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined
	} catch {
		return undefined
	}
}

function numbers(version: string): number[] | undefined {
	const m = /^v?(\d+(?:\.\d+)*)/.exec(version.trim())
	return m?.[1]?.split('.').map(Number)
}

// > 0 = a ใหม่กว่า b · undefined = เทียบเป็นตัวเลขไม่ได้
export function compareVersions(a: string, b: string): number | undefined {
	const x = numbers(a)
	const y = numbers(b)
	if (x === undefined || y === undefined) return undefined
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0)
		if (d !== 0) return d
	}
	return 0
}

function readOut(res: ProbeResult | undefined): string | undefined {
	if (res?.kind !== 'run' || res.exitCode !== 0) return undefined
	const text = res.stdout.trim()
	return text === '' ? undefined : text
}

function verdict(ctx: CheckContext, p: Params, ref: string, source: string, deploying: string, running: string): Step {
	const id = ctx.rule.id
	const allow = `ถ้าแน่ใจ ให้ผู้ใช้พิมพ์ /guards allow ${id}`
	const cmp = compareVersions(deploying, running)
	if (cmp === undefined) {
		if (deploying !== running) return PASS
	} else if (cmp > 0) return PASS
	if (cmp !== undefined && cmp < 0) {
		return {
			kind: 'deny',
			ruleId: id,
			message: `${p.versionFile} บน ${ref} = ${deploying} ต่ำกว่าที่รันอยู่ (${running}) · ${allow}`,
		}
	}
	return {
		kind: 'deny',
		ruleId: id,
		message: `${p.versionFile} บน ${ref} = ${deploying} (อ่านจาก ${source}) เท่ากับที่รันอยู่ ต้อง bump แล้ว merge เข้า ${ref} ก่อน deploy · ถามผู้ใช้ว่า patch, minor หรือ major`,
	}
}

export const versionBumped: Check = {
	start(ctx) {
		const { rule, vars, value } = ctx
		const params = parse(rule.params)
		const root = vars['repoRoot']
		if (params === undefined || root === undefined) {
			return { kind: 'deny', ruleId: rule.id, message: 'ตั้งค่า version-bumped ไม่ครบ' }
		}
		const allow = `ถ้าแน่ใจ ให้ผู้ใช้พิมพ์ /guards allow ${rule.id}`
		const ref = deployRef(value, params.defaultRef)
		const path = encodeURI(params.versionFile)
		return {
			// อ่าน VERSION ของ ref ที่จะ deploy จาก GitHub ก่อน (checkout บนเครื่องอาจล้าหลัง)
			probes: [
				{
					kind: 'run',
					argv: [
						'gh',
						'api',
						'-H',
						'Accept: application/vnd.github.raw',
						`repos/{owner}/{repo}/contents/${path}?ref=${ref}`,
					],
					cwd: root,
				},
				{ kind: 'fetch', url: params.versionUrl },
			],
			next: ([remote, res]) => {
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
					return {
						kind: 'deny',
						ruleId: rule.id,
						message: `${params.versionUrl} ไม่มี field "${params.field}" · ${allow}`,
					}
				}
				const fromGitHub = readOut(remote)
				if (fromGitHub !== undefined) return verdict(ctx, params, ref, 'GitHub', fromGitHub, running)
				// GitHub ไม่ตอบ: ใช้ origin/<ref> ที่ fetch ไว้ล่าสุด ห้ามใช้ไฟล์ใน checkout
				return {
					probes: [{ kind: 'run', argv: ['git', 'show', `origin/${ref}:${params.versionFile}`], cwd: root }],
					next: ([local]) => {
						const fromOrigin = readOut(local)
						if (fromOrigin !== undefined) return verdict(ctx, params, ref, `origin/${ref}`, fromOrigin, running)
						return {
							kind: 'deny',
							ruleId: rule.id,
							message: `อ่าน ${params.versionFile} ของ ${ref} ไม่ได้ทั้งจาก GitHub และ origin/${ref} จึงเช็กการ bump ไม่ได้ · ${allow}`,
						}
					},
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
		if (p['defaultRef'] !== undefined && (typeof p['defaultRef'] !== 'string' || !/^[\w./-]+$/.test(p['defaultRef'])))
			errors.push('params.defaultRef ต้องเป็นชื่อ branch')
		return errors
	},
}
