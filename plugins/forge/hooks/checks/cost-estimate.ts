import type { Check } from './types'

type Params = { estimateBaht: number; maxBaht: number; paidPattern?: string }

function parse(params: unknown): Params | undefined {
	if (typeof params !== 'object' || params === null) return undefined
	const p = params as Record<string, unknown>
	const estimateBaht = p['estimateBaht']
	const maxBaht = p['maxBaht']
	if (typeof estimateBaht !== 'number' || typeof maxBaht !== 'number') return undefined
	const paidPattern = typeof p['paidPattern'] === 'string' ? p['paidPattern'] : undefined
	return { estimateBaht, maxBaht, paidPattern }
}

export const costEstimate: Check = {
	start({ rule, value }) {
		const p = parse(rule.params)
		if (p === undefined) return { kind: 'deny', ruleId: rule.id, message: 'ตั้งค่า cost-estimate ไม่ครบ' }
		const ask = `บอกผู้ใช้ค่าใช้จ่ายโดยประมาณ แล้วให้ผู้ใช้พิมพ์ /guards allow ${rule.id} ถ้าจะรันต่อ`
		const paid = p.paidPattern === undefined ? null : new RegExp(p.paidPattern).exec(value)
		if (paid !== null) {
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `คำสั่งนี้ใช้ตัวเลือกที่เสียเงิน (${paid[0]}) ต้องให้ผู้ใช้ยืนยันก่อน · ${ask}`,
			}
		}
		if (p.estimateBaht > p.maxBaht) {
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `ประมาณค่าใช้จ่าย ~${p.estimateBaht} บาท เกินเพดาน ${p.maxBaht} บาท · ${ask}`,
			}
		}
		return {
			kind: 'warn',
			ruleId: rule.id,
			message: `ประมาณค่าใช้จ่าย ~${p.estimateBaht} บาท (ต่ำกว่าเพดาน ${p.maxBaht} บาท) · บอกผู้ใช้ด้วย`,
		}
	},
	validate(params) {
		const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
		const errors: string[] = []
		if (typeof p['estimateBaht'] !== 'number') errors.push('params.estimateBaht ต้องเป็นตัวเลข')
		if (typeof p['maxBaht'] !== 'number') errors.push('params.maxBaht ต้องเป็นตัวเลข')
		const pattern = p['paidPattern']
		if (pattern !== undefined && typeof pattern !== 'string') errors.push('params.paidPattern ต้องเป็นข้อความ')
		if (typeof pattern === 'string') {
			try {
				new RegExp(pattern)
			} catch (err) {
				errors.push(`params.paidPattern ไม่ใช่ regex ที่ใช้ได้: ${err instanceof Error ? err.message : String(err)}`)
			}
		}
		return errors
	},
}
