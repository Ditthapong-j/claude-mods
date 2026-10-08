import type { Rule } from './types'

export const BUILTIN_RULES: readonly Rule[] = [
	{
		id: 'named-stash',
		tools: ['Bash'],
		field: 'command',
		match: '(?:^|[;&|]\\s*|\\s)git\\s+stash(?:\\s+(?:push|pop|save))?(?=\\s|$)',
		unless: '\\s(?:-m|--message)[\\s=]|git\\s+stash\\s+(?:list|show|apply\\s+\\S|drop\\s+\\S|branch\\s)',
		action: 'deny',
		why: 'stash stack ใช้ร่วมกับทุก worktree และทุก session อาจไปหยิบงานของคนอื่น',
		hint: 'ใช้ WIP commit หรือ git stash push -u -m "<tag>" แล้วจด SHA ไว้ apply ด้วย SHA',
		examples: {
			hit: ['git stash', 'git stash pop', 'cd x && git stash'],
			miss: ['git stash push -u -m "wip-x"', 'git stash list', 'git stash apply 3f2a1b'],
		},
		enabled: true,
	},
	{
		id: 'branch-base',
		tools: ['Bash'],
		field: 'command',
		match: '^(\\s*git\\s+(?:checkout\\s+-b|switch\\s+-c)\\s+\\S+)\\s*$',
		requires: ['baseBranch'],
		action: 'rewrite',
		rewrite: '$1 {baseBranch}',
		why: 'branch ใหม่ต้องแตกจากฐานของ repo ไม่ใช่จาก branch ที่อยู่ตอนนี้',
		examples: {
			hit: ['git checkout -b fix/a', 'git switch -c fix/a'],
			miss: ['git checkout -b fix/a origin/develop', 'git checkout main'],
		},
		enabled: true,
	},
]
