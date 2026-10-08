#!/usr/bin/env node
// สแกนไฟล์ที่ git track อยู่ หาคำต้องห้ามจาก .forbidden-words (ไม่ commit) ทีละบรรทัด ไม่สนตัวพิมพ์
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const LIST = '.forbidden-words'
if (!existsSync(LIST)) {
	console.error(`ไม่มี ${LIST} — สร้างไฟล์นี้ใส่คำต้องห้ามบรรทัดละคำก่อน push`)
	process.exit(1)
}
const words = readFileSync(LIST, 'utf8')
	.split('\n')
	.map((w) => w.trim())
	.filter((w) => w.length > 0 && !w.startsWith('#'))
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const hits = []
for (const file of files) {
	const text = readFileSync(file, 'utf8').toLowerCase()
	for (const word of words) {
		if (text.includes(word.toLowerCase())) hits.push(`${file}: "${word}"`)
	}
}
if (hits.length > 0) {
	console.error(`พบคำต้องห้าม ${hits.length} จุด:\n${hits.join('\n')}`)
	process.exit(1)
}
console.log(`check-forbidden: ผ่าน (${files.length} ไฟล์, ${words.length} คำ)`)
