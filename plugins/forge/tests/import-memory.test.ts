import { expect, test } from 'claude-code/testing'

import { world } from './helpers'

const P = { isFullscreen: false, columns: 120 }

test('import-memory drafts one rule per usable feedback file and skips the rest', async ($, on) => {
	world(on, {
		root: null,
		files: {
			'/m': '',
			'/m/feedback_a.md': 'อย่าใช้ git stash เปล่า',
			'/m/feedback_b.md': 'ไม่มีอะไรบังคับได้',
			'/m/feedback_c.md': '',
		},
	})
	on('fs.list', () => ({
		value: ['feedback_a.md', 'feedback_b.md', 'feedback_c.md', 'project_x.md'].map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
	}))
	on('model.complete', ($, e) => {
		const prompt = String((e as unknown as Record<string, unknown>)['prompt'])
		const text = prompt.includes('feedback_a.md')
			? '{"id":"bare-stash","tool":"Bash","match":"^git stash$","action":"deny","why":"x","examples":{"hit":["git stash"],"miss":["git status","git stash list"]}}'
			: 'NO_RULE'
		return {
			value: {
				isAnswered: true,
				text,
				usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
			},
		}
	})
	const res = await $.command.run({
		command: 'lessons',
		args: 'import-memory /m',
		origin: { kind: 'composer' },
		presentation: P,
	})
	expect(res.text).toContain('ได้ร่างกฎ 1 ข้อ')
	expect(res.text).toContain('feedback_b.md')
	const accepted = await $.command.run({
		command: 'lessons',
		args: 'accept any-repo',
		origin: { kind: 'composer' },
		presentation: P,
	})
	expect(accepted.text).toContain('bare-stash')
})
