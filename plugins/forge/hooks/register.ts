import type { Register } from 'claude-code'

export const register: Register = (on) => {
	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: 'guards',
			description: 'ดูกฎที่ทำงานอยู่และสิ่งที่ถูกดัก หรือยกเว้นกฎครั้งเดียว (/guards allow <id>)',
		})
		return next(e)
	})
}
