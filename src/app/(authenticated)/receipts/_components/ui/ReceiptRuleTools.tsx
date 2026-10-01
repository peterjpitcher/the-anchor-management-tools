'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds'
import {
  getReceiptRuleHealth,
  getReceiptSettings,
  getRecentReceiptRuleRuns,
  getRuleMatcherComparison,
  setReceiptRuleMatcher,
  setReceiptsLockDate,
  testReceiptRules,
} from '@/app/actions/receipt-rules'
import { useRetroRuleRunner } from '@/hooks/useRetroRuleRunner'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { MatcherComparison, RuleMatchExplanation } from '@/lib/receipts/rule-health'
import type { RuleMatcherMode } from '@/lib/receipts/rule-matching'
import type { ReceiptRuleHealth, RuleRunRecord } from '@/services/receipts/receiptRuleRuns'
import type { ReceiptSettings } from '@/services/receipts/receiptSettings'
import type { ReceiptRule } from '@/types/database'
import { RECEIPT_STATUS_LABEL } from '../../_shared/status-ui'

interface ReceiptRuleToolsProps {
  rules: ReceiptRule[]
  /** `receipts:manage`. */
  canManage: boolean
  /** Super admin: the lock date, the matcher and runs over all history. */
  canGovern: boolean
}

type HealthFilter = 'all' | 'never' | 'stale' | 'shadowed'

const HEALTH_FILTERS: Array<{ value: HealthFilter; label: string }> = [
  { value: 'all', label: 'All rules' },
  { value: 'never', label: 'Never matched' },
  { value: 'stale', label: 'No match in 90 days' },
  { value: 'shadowed', label: 'Always beaten by another rule' },
]

const RUN_STATUS_LABEL: Record<RuleRunRecord['status'], string> = {
  drafting: 'Preview',
  previewed: 'Preview',
  running: 'Not finished',
  completed: 'Completed',
  stopped: 'Stopped',
  undone: 'Undone',
}

const RUN_KIND_LABEL: Record<RuleRunRecord['kind'], string> = {
  rule_run: 'Rule run',
  bulk_apply: 'Bulk change',
  ai_accept_all: 'Accepted suggestions',
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function day(value: string | null): string {
  return value ? formatDateInLondon(value, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'
}

/**
 * The tools around the rules: the lock date, recent runs with undo, a box to test a bank
 * description against the rules, and how each rule is doing. Each part loads its own data when
 * it is first needed, so opening the rules does not wait on any of it.
 */
export function ReceiptRuleTools({ rules, canManage, canGovern }: ReceiptRuleToolsProps) {
  const router = useRouter()
  const { undoRun, isUndoing } = useRetroRuleRunner()
  const [isPending, startTransition] = useTransition()

  const [settings, setSettings] = useState<ReceiptSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [lockDraft, setLockDraft] = useState('')
  const [runs, setRuns] = useState<RuleRunRecord[] | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [undoTarget, setUndoTarget] = useState<RuleRunRecord | null>(null)

  const [testDetails, setTestDetails] = useState('')
  const [testDirection, setTestDirection] = useState<'in' | 'out'>('out')
  const [testAmount, setTestAmount] = useState('')
  const [testResult, setTestResult] = useState<(RuleMatchExplanation & { matcher: RuleMatcherMode }) | null>(null)

  const [health, setHealth] = useState<ReceiptRuleHealth | null>(null)
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')

  const [comparison, setComparison] = useState<(MatcherComparison & { matcher: RuleMatcherMode; truncated: boolean }) | null>(null)
  const [matcherTarget, setMatcherTarget] = useState<RuleMatcherMode | null>(null)

  const ruleNames = useMemo(() => new Map(rules.map((rule) => [rule.id, rule.name])), [rules])

  async function loadSettingsAndRuns() {
    const [settingsResult, runsResult] = await Promise.all([getReceiptSettings(), getRecentReceiptRuleRuns()])
    if (settingsResult.settings) {
      setSettings(settingsResult.settings)
      setLockDraft(settingsResult.settings.lockDate ?? '')
      setSettingsError(null)
    } else {
      setSettingsError(settingsResult.error ?? 'The settings could not be loaded.')
    }
    if (runsResult.runs) {
      setRuns(runsResult.runs)
      setRunsError(null)
    } else {
      setRunsError(runsResult.error ?? 'The recent runs could not be loaded.')
    }
  }

  useEffect(() => {
    void loadSettingsAndRuns()
  }, [])

  function saveLockDate(value: string | null) {
    startTransition(async () => {
      const result = await setReceiptsLockDate(value)
      if (!result.success) {
        toast.error(result.error ?? 'The lock date could not be saved.')
        return
      }
      toast.success(value ? `Locked up to ${day(value)}` : 'Lock removed')
      await loadSettingsAndRuns()
      router.refresh()
    })
  }

  function runTest() {
    startTransition(async () => {
      const amount = Number(testAmount)
      const result = await testReceiptRules({
        details: testDetails,
        direction: testDirection,
        amount: Number.isFinite(amount) ? amount : 0,
      })
      if (!result.result) {
        toast.error(result.error ?? 'The rules could not be tested.')
        return
      }
      setTestResult(result.result)
    })
  }

  function loadHealth() {
    startTransition(async () => {
      const result = await getReceiptRuleHealth()
      if (!result.health) {
        toast.error(result.error ?? 'Rule health could not be worked out.')
        return
      }
      setHealth(result.health)
    })
  }

  function loadComparison() {
    startTransition(async () => {
      const result = await getRuleMatcherComparison()
      if (!result.comparison) {
        toast.error(result.error ?? 'The comparison could not be worked out.')
        return
      }
      setComparison(result.comparison)
    })
  }

  function switchMatcher(mode: RuleMatcherMode) {
    startTransition(async () => {
      const result = await setReceiptRuleMatcher(mode)
      setMatcherTarget(null)
      if (!result.success) {
        toast.error(result.error ?? 'The setting could not be saved.')
        return
      }
      toast.success(mode === 'word' ? 'Keywords now match whole words only' : 'Keywords now match anywhere in the description')
      setComparison(null)
      setHealth(null)
      await loadSettingsAndRuns()
      router.refresh()
    })
  }

  const healthRows = useMemo(() => {
    if (!health) return []
    return health.items
      .filter((item) => {
        if (healthFilter === 'never') return item.matches === 0
        if (healthFilter === 'stale') return item.matches > 0 && item.matchesLast90Days === 0
        if (healthFilter === 'shadowed') return Boolean(item.shadowedBy)
        return true
      })
      .sort((left, right) => right.matches - left.matches)
  }, [health, healthFilter])

  const busy = isPending || isUndoing

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Lock date"
            subtitle="Transactions dated on or before it are left alone by rules, bulk changes and the AI"
          />
          <CardBody className="space-y-3">
            {settingsError ? (
              <Alert tone="danger">{settingsError}</Alert>
            ) : !settings ? (
              <p className="text-text-muted">Loading…</p>
            ) : (
              <>
                <p>
                  {settings.lockDate
                    ? `Locked up to and including ${day(settings.lockDate)}.`
                    : 'No lock is set. Every transaction can be changed by a rule run.'}
                </p>
                {canGovern ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      label="Lock transactions up to"
                      type="date"
                      value={lockDraft}
                      onChange={(event) => setLockDraft(event.target.value)}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => saveLockDate(lockDraft || null)}
                      disabled={busy || lockDraft === (settings.lockDate ?? '') || !lockDraft}
                      loading={isPending}
                    >
                      Save Lock Date
                    </Button>
                    {settings.lockDate && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => saveLockDate(null)} disabled={busy}>
                        Remove Lock
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">Only a super admin can change the lock date.</p>
                )}
                <p className="text-sm text-text-muted">
                  A single transaction can still be corrected by hand, and a vendor rename or merge still updates the
                  name on locked transactions.
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Test a description" subtitle="See which rule decides the status, vendor and category" />
          <CardBody className="space-y-3">
            <Input
              label="Bank description"
              value={testDetails}
              onChange={(event) => setTestDetails(event.target.value)}
              placeholder="Paste the text from a bank statement line"
              maxLength={500}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Direction"
                value={testDirection}
                onChange={(event) => setTestDirection(event.target.value as 'in' | 'out')}
                options={[
                  { value: 'out', label: 'Money out' },
                  { value: 'in', label: 'Money in' },
                ]}
              />
              <Input
                label="Amount (optional)"
                type="number"
                min={0}
                step="0.01"
                value={testAmount}
                onChange={(event) => setTestAmount(event.target.value)}
              />
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={runTest} disabled={busy || !testDetails.trim()} loading={isPending}>
              Test Rules
            </Button>

            {testResult && (
              <div className="space-y-2" role="status">
                {testResult.matched.length === 0 ? (
                  <Alert tone="info">No rule matches this description.</Alert>
                ) : (
                  <>
                    <ul className="space-y-1">
                      <li>
                        <span className="font-medium text-text-strong">Status:</span>{' '}
                        {testResult.status
                          ? `${RECEIPT_STATUS_LABEL[testResult.status.outcome as keyof typeof RECEIPT_STATUS_LABEL] ?? testResult.status.outcome}, from "${testResult.status.name}"`
                          : 'no rule decides it'}
                      </li>
                      <li>
                        <span className="font-medium text-text-strong">Vendor:</span>{' '}
                        {testResult.vendor ? `${testResult.vendor.value}, from "${testResult.vendor.name}"` : 'no rule sets one'}
                      </li>
                      <li>
                        <span className="font-medium text-text-strong">Category:</span>{' '}
                        {testResult.category
                          ? `${testResult.category.value}, from "${testResult.category.name}"`
                          : 'no rule sets one'}
                      </li>
                    </ul>
                    <p className="text-sm text-text-muted">
                      {plural(testResult.matched.length, 'rule matches', 'rules match')}, best first:{' '}
                      {testResult.matched.map((rule) => `${rule.name} (priority ${rule.priority})`).join(', ')}. A lower
                      priority number wins; between equals, the longer keyword wins.
                    </p>
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent runs" subtitle="Rule runs and bulk changes that altered transactions. Each can be undone." />
        <CardBody>
          {runsError ? (
            <Alert tone="danger">{runsError}</Alert>
          ) : !runs ? (
            <p className="text-text-muted">Loading…</p>
          ) : runs.length === 0 ? (
            <Empty title="No runs yet" size="sm" variant="minimal" />
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => {
                const canUndo =
                  canManage && (run.scope !== 'all' || canGovern) && run.applied > 0 && run.status !== 'undone'
                return (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="text-text-strong">
                        {RUN_KIND_LABEL[run.kind]}: {run.label ?? (run.ruleId ? ruleNames.get(run.ruleId) : null) ?? 'Unnamed'}
                      </p>
                      <p className="text-sm text-text-muted">
                        {day(run.createdAt)} · {run.scope === 'all' ? 'all transactions' : 'pending transactions'} ·{' '}
                        {plural(run.applied, 'changed', 'changed')}
                        {run.skippedChanged > 0 ? ` · ${run.skippedChanged} skipped (edited since the preview)` : ''}
                        {run.skippedLocked > 0 ? ` · ${run.skippedLocked} skipped (locked)` : ''}
                        {run.status === 'undone'
                          ? ` · ${run.undone} put back${run.undoConflicts > 0 ? `, ${run.undoConflicts} left as they were` : ''}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={run.status === 'completed' ? 'success' : run.status === 'undone' ? 'neutral' : 'warning'}>
                        {RUN_STATUS_LABEL[run.status]}
                      </Badge>
                      {canUndo && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setUndoTarget(run)} disabled={busy}>
                          Undo
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage && (
        <Card>
          <CardHeader
            title="Rule health"
            subtitle="How many transactions each rule matches and wins, worked out from every transaction"
            action={
              <Button type="button" variant="secondary" size="sm" onClick={loadHealth} disabled={busy} loading={isPending}>
                {health ? 'Check Again' : 'Check Rule Health'}
              </Button>
            }
          />
          {health && (
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label="Show"
                  value={healthFilter}
                  onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
                  options={HEALTH_FILTERS}
                />
                <p className="text-sm text-text-muted">
                  {plural(healthRows.length, 'rule', 'rules')} shown, from {health.reviewed} transactions.
                </p>
              </div>
              {healthRows.length === 0 ? (
                <Empty title="No rules match this filter" size="sm" variant="minimal" />
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rule</TableHead>
                        <TableHead align="right">Matches</TableHead>
                        <TableHead align="right">Wins</TableHead>
                        <TableHead align="right">Last 90 days</TableHead>
                        <TableHead>Last matched</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {healthRows.map((item) => (
                        <TableRow key={item.ruleId}>
                          <TableCell>{ruleNames.get(item.ruleId) ?? 'Unknown rule'}</TableCell>
                          <TableCell align="right">{item.matches}</TableCell>
                          <TableCell align="right">{item.wins}</TableCell>
                          <TableCell align="right">{item.matchesLast90Days}</TableCell>
                          <TableCell>{day(item.lastMatchedDate)}</TableCell>
                          <TableCell>
                            {item.matches === 0
                              ? 'Never matched'
                              : item.shadowedBy
                                ? `Always beaten by "${item.shadowedBy.name}"`
                                : item.matchesLast90Days === 0
                                  ? 'No match in 90 days'
                                  : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardBody>
          )}
        </Card>
      )}

      {canGovern && settings && (
        <Card>
          <CardHeader
            title="Keyword matching"
            subtitle={
              settings.matcher === 'word'
                ? 'Keywords match whole words only'
                : 'Keywords of four letters or more match anywhere in the description, including inside a longer word'
            }
            action={
              <Button type="button" variant="secondary" size="sm" onClick={loadComparison} disabled={busy} loading={isPending}>
                Compare The Two
              </Button>
            }
          />
          {comparison && (
            <CardBody className="space-y-3">
              <p>
                Of {comparison.reviewed} transactions, {plural(comparison.paymentsAffected, 'would', 'would')} be decided by a
                different rule, or by none, if keywords had to be whole words. Nothing is changed by looking.
              </p>
              {comparison.differences.length > 0 && (
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Anywhere in the description</TableHead>
                        <TableHead>Whole words only</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparison.differences.map((difference) => (
                        <TableRow key={`${difference.transactionId}:${difference.field}`}>
                          <TableCell>
                            <span className="block break-words text-text-strong">{difference.details}</span>
                            <span className="text-text-muted">{day(difference.transactionDate)}</span>
                          </TableCell>
                          <TableCell>{difference.field === 'expense' ? 'category' : difference.field}</TableCell>
                          <TableCell>{difference.fromRule?.name ?? 'No rule'}</TableCell>
                          <TableCell>{difference.toRule?.name ?? 'No rule'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {comparison.truncated && <p className="text-sm text-text-muted">Only the first 200 differences are shown.</p>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMatcherTarget(settings.matcher === 'word' ? 'substring' : 'word')}
                disabled={busy}
              >
                {settings.matcher === 'word' ? 'Switch To Matching Anywhere' : 'Switch To Whole Words Only'}
              </Button>
            </CardBody>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(undoTarget)}
        onClose={() => setUndoTarget(null)}
        onConfirm={() => {
          if (!undoTarget) return
          const run = undoTarget
          setUndoTarget(null)
          undoRun(run.id, () => void loadSettingsAndRuns())
        }}
        title="Undo run"
        message={
          undoTarget
            ? `${plural(undoTarget.applied, 'transaction goes', 'transactions go')} back to what ${undoTarget.applied === 1 ? 'it was' : 'they were'} before this run. Any that someone has changed since, or that are now locked, are left as they are.`
            : ''
        }
        confirmLabel="Undo"
        tone="primary"
      />

      <ConfirmDialog
        open={Boolean(matcherTarget)}
        onClose={() => setMatcherTarget(null)}
        onConfirm={() => {
          if (matcherTarget) switchMatcher(matcherTarget)
        }}
        title="Change keyword matching"
        message={
          matcherTarget === 'word'
            ? 'From now on a keyword only matches where it stands as a whole word. Existing transactions are not changed; the difference shows the next time rules run.'
            : 'From now on a keyword of four letters or more matches anywhere in the description. Existing transactions are not changed; the difference shows the next time rules run.'
        }
        confirmLabel="Change"
        tone="primary"
      />
    </div>
  )
}
