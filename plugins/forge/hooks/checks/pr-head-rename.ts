import { PASS } from '../match'
import type { CheckContext, Check, ProbeResult, Step } from './types'

function renameTargets(command: string): string[] {
	const m = /git\s+branch\s+(?:-m|-M|--move)\s+(.*)$/.exec(command)
	return (m?.[1] ?? '').split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('-'))
}

function askGitHub({ rule, vars }: CheckContext, old: string): Step {
	return {
		probes: [
			{
				kind: 'run',
				argv: ['gh', 'pr', 'list', '--head', old, '--state', 'open', '--json', 'number', '--jq', '.[].number'],
				cwd: vars['repoRoot'],
			},
		],
		next: ([prs]) => {
			if (prs?.kind !== 'run' || prs.exitCode !== 0) {
				const reason = prs?.kind === 'run' ? prs.stderr.trim() : prs?.kind === 'error' ? prs.message : 'ไม่มีผล'
				return {
					kind: 'warn',
					ruleId: rule.id,
					message: `เช็ก PR ของ branch ${old} ไม่ได้ (${reason.slice(0, 120)}) ถ้า branch นี้มี PR เปิดอยู่ การ rename จะทำให้ GitHub ปิด PR`,
				}
			}
			const numbers = prs.stdout.trim().split('\n').filter(Boolean)
			if (numbers.length === 0) return PASS
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `branch ${old} เป็น head ของ PR #${numbers.join(', #')} ถ้า rename GitHub จะปิด PR · ทำงานต่อบน branch เดิม`,
			}
		},
	}
}

function currentBranch(res: ProbeResult | undefined): string | undefined {
	if (res?.kind !== 'run' || res.exitCode !== 0) return undefined
	const name = res.stdout.trim()
	return name === '' ? undefined : name
}

export const prHeadRename: Check = {
	start(ctx) {
		const args = renameTargets(ctx.value)
		const old = args.length >= 2 ? args[0] : undefined
		if (old !== undefined) return askGitHub(ctx, old)
		return {
			probes: [{ kind: 'run', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd: ctx.vars['repoRoot'] }],
			next: ([head]) => {
				const name = currentBranch(head)
				return name === undefined ? PASS : askGitHub(ctx, name)
			},
		}
	},
	validate: () => [],
}
