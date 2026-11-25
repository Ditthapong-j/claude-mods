import { interpolate, judge } from './match'
import type { Rule, Vars } from './types'

// ข้อความบนการ์ดร่างกฎ: บอกผลเป็นภาษาคน + ตัวอย่างคำสั่งจริง แทน regex
export type Card = {
	title: string
	why: string
	hint?: string
	effect: string
	examples: { label: string; text: string }[]
	source: string
}

const MAX = 140

function clip(text: string): string {
	const one = text.replace(/\s+/g, ' ').trim()
	return one.length > MAX ? `${one.slice(0, MAX - 1)}…` : one
}

function effect(rule: Rule): string {
	if (rule.action === 'rewrite') return 'ผล: แก้คำสั่งให้เองแล้วรันต่อ'
	if (rule.action === 'warn') return 'ผล: เตือน แต่คำสั่งยังรัน'
	return `ผล: หยุดคำสั่ง · ถ้าจะให้ผ่านครั้งเดียว คุณพิมพ์ /guards allow ${rule.id}`
}

function target(rule: Rule): string {
	if (rule.field === 'file_path') return 'แก้ไฟล์'
	if (rule.field === 'command') return 'คำสั่ง'
	return 'การเรียก'
}

export function draftCard(rule: Rule, lesson: string, vars: Vars): Card {
	const examples: Card['examples'] = []
	const hit = rule.examples.hit[0]
	const miss = rule.examples.miss[0]
	if (hit !== undefined) {
		const verdict = rule.check === undefined ? judge(rule, hit, vars) : undefined
		if (verdict?.kind === 'rewrite') {
			examples.push({ label: 'ก่อน', text: clip(hit) })
			examples.push({ label: 'หลัง', text: clip(verdict.value) })
		} else {
			examples.push({ label: `${target(rule)}ที่โดน`, text: clip(hit) })
		}
	}
	if (miss !== undefined) examples.push({ label: `${target(rule)}ที่ไม่โดน`, text: clip(miss) })
	return {
		title: `forge ขอเปิดกฎใหม่: ${rule.id}`,
		why: clip(rule.why),
		...(rule.hint === undefined ? {} : { hint: clip(`วิธีที่ถูก: ${interpolate(rule.hint, vars)}`) }),
		effect: effect(rule),
		examples,
		source: clip(`ที่มา: ${lesson}`),
	}
}
