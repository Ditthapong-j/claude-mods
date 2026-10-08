import { toRule } from './config'
import { judge, triggers } from './match'
import type { Rule, Vars } from './types'

export type RecentCall = { tool: string; summary: string }

const MIN_CHARS = 20

export function isLessonCandidate(text: string, calls: readonly RecentCall[]): boolean {
	return text.trim().length >= MIN_CHARS && calls.length > 0
}

export function draftPrompt(text: string, calls: readonly RecentCall[]): string {
	const recent = calls.map((c, i) => `${i + 1}. ${c.tool}: ${c.summary}`).join('\n')
	return [
		'ผู้ใช้เพิ่งแก้พฤติกรรมของ Claude Code ด้วยข้อความด้านล่าง หลังการเรียก tool เหล่านี้',
		`ข้อความผู้ใช้: ${text}`,
		`การเรียก tool ล่าสุด:\n${recent}`,
		'',
		'ถ้าบทเรียนนี้บังคับได้ด้วยการตรวจข้อความของการเรียก tool ให้ตอบเป็น JSON object เดียว รูปแบบ:',
		'{"id":"kebab-case","tool":"Bash","field":"command","match":"<regex>","unless":"<regex หรือไม่ใส่>","action":"deny|warn|rewrite","rewrite":"<เฉพาะ rewrite ใช้ $& หรือ $1>","why":"<เหตุผลภาษาไทย>","hint":"<วิธีที่ถูก>","examples":{"hit":["<คำสั่งที่พลาดจริงด้านบน>"],"miss":["<คำสั่งที่ถูกต้องที่ต้องไม่โดน>"]}}',
		'ใช้คำสั่งที่พลาดจริงเป็น examples.hit อย่างน้อย 1 ตัว และ examples.miss อย่างน้อย 2 ตัว',
		'rewrite ห้ามเพิ่ม ; && || | $( ` > < ใหม่; ถ้าไม่แน่ใจให้ใช้ deny',
		'ถ้าบังคับด้วยการตรวจข้อความไม่ได้ ตอบคำเดียว: NO_RULE',
	].join('\n')
}

function firstObject(text: string): string | undefined {
	const start = text.indexOf('{')
	if (start < 0) return undefined
	let depth = 0
	let inString = false
	for (let i = start; i < text.length; i++) {
		const c = text.charAt(i)
		if (inString) {
			if (c === '\\') i++
			else if (c === '"') inString = false
		} else if (c === '"') inString = true
		else if (c === '{') depth++
		else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
	}
	return undefined
}

export function parseDraft(answer: string): { rule: Rule } | { error: string } {
	if (answer.trim() === 'NO_RULE') return { error: 'โมเดลบอกว่าบทเรียนนี้เป็นกฎเครื่องไม่ได้' }
	const json = firstObject(answer)
	if (json === undefined) return { error: 'ไม่พบ JSON ในคำตอบของโมเดล' }
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch (err) {
		return { error: `JSON ของร่างกฎพัง: ${err instanceof Error ? err.message : String(err)}` }
	}
	const { rule, error } = toRule(raw, 0)
	return rule === undefined ? { error: error ?? 'ร่างกฎใช้ไม่ได้' } : { rule }
}

export function tooBroad(rule: Rule, history: readonly string[], vars: Vars): string | undefined {
	if (!rule.tools.includes('Bash') || rule.field !== 'command') return undefined
	const caught = history.filter((cmd) =>
		rule.check === undefined ? judge(rule, cmd, vars).kind !== 'pass' : triggers(rule, cmd)
	)
	if (caught.length === 0) return undefined
	return `กฎกว้างเกิน: จะดักคำสั่งที่เพิ่งรันผ่านไปด้วยดี ${caught.length} ครั้ง เช่น ${caught.slice(0, 3).join(' · ')}`
}
