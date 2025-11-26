'use client'

import { useState, useTransition, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import {
  toggleReceiptRule,
  createReceiptRule,
  updateReceiptRule,
  deleteReceiptRule,
  runReceiptRuleRetroactivelyStep,
  finalizeReceiptRuleRetroRun,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ReceiptRule, ReceiptTransaction } from '@/types/database'

interface ReceiptRulesProps {
  rules: ReceiptRule[]
  pendingSuggestion: ClassificationRuleSuggestion | null
  onApplySuggestion: (suggestion: ClassificationRuleSuggestion) => void
  onDismissSuggestion: () => void
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options
const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

export function ReceiptRules({ rules, pendingSuggestion, onApplySuggestion, onDismissSuggestion }: ReceiptRulesProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')
  
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [retroRuleId, setRetroRuleId] = useState<string | null>(null)
  const [isRulePending, startRuleTransition] = useTransition()
  const [isRetroPending, startRetroTransition] = useTransition()
  const [retroPrompt, setRetroPrompt] = useState<{ id: string; name: string } | null>(null)
  const [retroScope, setRetroScope] = useState<'pending' | 'all'>('all')
  const newRuleFormRef = useRef<HTMLFormElement | null>(null)

  // Expose the form ref to parent if needed, or handle suggestion application internally if passed as prop
  // For now, we'll assume the parent handles the "prefill" logic by passing a key or we handle it here.
  // Wait, the `applyRuleSuggestion` in the original code manipulated the DOM directly using the ref.
  // We should probably replicate that or use controlled inputs. Controlled inputs are better but more verbose.
  // Given the refactor, I'll stick to the DOM manipulation for now to match the original behavior, 
  // but I need to expose the ref or move the `applyRuleSuggestion` logic HERE.
  // Yes, moving it here makes sense.

  function applySuggestion(suggestion: ClassificationRuleSuggestion) {
    const form = newRuleFormRef.current
    if (!form) return

    const getInput = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as T | null

    const nameInput = getInput<HTMLInputElement>('name')
    if (nameInput) nameInput.value = suggestion.suggestedName

    const matchDescriptionInput = getInput<HTMLInputElement>('match_description')
    if (matchDescriptionInput) {
      matchDescriptionInput.value = suggestion.matchDescription ?? ''
    }

    const matchTypeInput = getInput<HTMLInputElement>('match_transaction_type')
    if (matchTypeInput) matchTypeInput.value = suggestion.transactionType ?? ''

    const matchDirectionSelect = getInput<HTMLSelectElement>('match_direction')
    if (matchDirectionSelect) matchDirectionSelect.value = suggestion.direction

    const vendorInput = getInput<HTMLInputElement>('set_vendor_name')
    if (vendorInput) vendorInput.value = suggestion.setVendorName ?? ''

    const expenseSelect = getInput<HTMLSelectElement>('set_expense_category')
    if (expenseSelect) expenseSelect.value = suggestion.setExpenseCategory ?? ''

    const autoStatusSelect = getInput<HTMLSelectElement>('auto_status')
    if (autoStatusSelect) autoStatusSelect.value = 'pending'

    const descriptionInput = getInput<HTMLInputElement>('description')
    if (descriptionInput) descriptionInput.value = ''

    const minAmountInput = getInput<HTMLInputElement>('match_min_amount')
    if (minAmountInput) minAmountInput.value = ''

    const maxAmountInput = getInput<HTMLInputElement>('match_max_amount')
    if (maxAmountInput) maxAmountInput.value = ''

    form.scrollIntoView({ behavior: 'smooth', block: 'center' })
    toast.success('Prefilled the new rule form from your classification')
    onApplySuggestion(suggestion) // Notify parent to clear suggestion
  }
  
  // If the parent passes a pending suggestion, we can try to apply it if we want, 
  // but usually it's triggered by a user action. 
  // The original code had a "Apply" button in a banner.
  
  function handleRetroRun(ruleId: string, scope: 'pending' | 'all') {
    if (!canManageReceipts) {
      toast.error('You do not have permission to manage receipts.')
      return
    }
    setRetroRuleId(ruleId)
    startRetroTransition(async () => {
      try {
        const CHUNK_SIZE = 100
        const MAX_ITERATIONS = 300

        let offset = 0
        let iterations = 0
        let lastSamples: Array<Record<string, unknown>> = []
        const totals = {
          reviewed: 0,
          matched: 0,
          statusAutoUpdated: 0,
          classificationUpdated: 0,
          vendorIntended: 0,
          expenseIntended: 0,
        }

        while (iterations < MAX_ITERATIONS) {
          const step = await runReceiptRuleRetroactivelyStep({
            ruleId,
            scope,
            offset,
            chunkSize: CHUNK_SIZE,
          })

          if (!step.success) {
            toast.error(step.error)
            break
          }

          totals.reviewed += step.reviewed
          totals.matched += step.matched
          totals.statusAutoUpdated += step.statusAutoUpdated
          totals.classificationUpdated += step.classificationUpdated
          totals.vendorIntended += step.vendorIntended
          totals.expenseIntended += step.expenseIntended

          if (step.samples.length) {
            lastSamples = step.samples
          }

          offset = step.nextOffset
          iterations += 1

          if (step.done) {
            await finalizeReceiptRuleRetroRun({
              ruleId,
              scope,
              reviewed: totals.reviewed,
              statusAutoUpdated: totals.statusAutoUpdated,
              classificationUpdated: totals.classificationUpdated,
              matched: totals.matched,
              vendorIntended: totals.vendorIntended,
              expenseIntended: totals.expenseIntended,
            })
            
            const scopeLabel = scope === 'all' ? 'transactions' : 'pending transactions'
            toast.success(
              `Rule processed ${totals.matched} / ${totals.reviewed} ${scopeLabel} · ${totals.statusAutoUpdated} status updates · ${totals.classificationUpdated} classifications`
            )

            if (lastSamples.length) {
              console.groupCollapsed(`Receipt rule analysis (${lastSamples.length} sample transactions)`)
              console.table(lastSamples)
              console.groupEnd()
            }

            setRetroPrompt(null)
            setRetroScope('pending')
            router.refresh()
            return
          }

          if (step.reviewed === 0) {
            break
          }
        }

        toast.error('Stopped before completion. Please run again to continue.')
      } catch (error) {
        console.error('Failed to run receipt rule retroactively', error)
        toast.error('Failed to run the rule. Please try again.')
      } finally {
        setRetroPrompt(null)
        setRetroRuleId(null)
      }
    })
  }

  async function handleRuleToggle(rule: ReceiptRule) {
    if (!canManageReceipts) return
    setActiveRuleId(rule.id)
    startRuleTransition(async () => {
      const result = await toggleReceiptRule(rule.id, !rule.is_active)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success(`Rule ${rule.is_active ? 'disabled' : 'enabled'}`)
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleRuleDelete(ruleId: string) {
    if (!canManageReceipts) return
    if (!confirm('Delete this rule?')) return
    setActiveRuleId(ruleId)
    startRuleTransition(async () => {
      const result = await deleteReceiptRule(ruleId)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success('Rule deleted')
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleRuleSubmit(event: FormEvent<HTMLFormElement>, ruleId?: string) {
    event.preventDefault()
    if (!canManageReceipts) return
    
    const formElement = event.currentTarget
    const formData = new FormData(formElement)

    setActiveRuleId(ruleId ?? 'new')
    startRuleTransition(async () => {
      const result = ruleId
        ? await updateReceiptRule(ruleId, formData)
        : await createReceiptRule(formData)

      if (!result || 'error' in result) {
        toast.error(result?.error ?? 'Failed to save rule')
        setActiveRuleId(null)
        return
      }
      toast.success(`Rule ${ruleId ? 'updated' : 'created'}`)
      const createdRule = result.rule
      if (result.canPromptRetro && createdRule) {
        setRetroPrompt({ id: createdRule.id, name: createdRule.name })
        setRetroScope('pending')
      }
      setEditingRuleId(null)
      if (!ruleId) formElement.reset()
      router.refresh()
      setActiveRuleId(null)
    })
  }

  return (
    <Card className="hidden md:block" header={<div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Automation rules</h2>
        <p className="text-sm text-gray-500">Automatically tick off known transactions (e.g. card settlements).</p>
      </div>
      <Badge variant="secondary">{rules.length} rules</Badge>
    </div>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          variant="bordered"
          header={<h3 className="text-md font-semibold text-gray-900">New rule</h3>}
        >
          {pendingSuggestion && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-emerald-800">
                  Suggestion ready for {pendingSuggestion.setVendorName ?? pendingSuggestion.setExpenseCategory}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => applySuggestion(pendingSuggestion)}
                  >
                    Apply
                  </Button>
                  <Button size="xs" variant="ghost" onClick={onDismissSuggestion}>
                    Dismiss
                  </Button>
                </div>
              </div>
              <p className="mt-1">Prefill the form to auto-tag similar transactions next time.</p>
            </div>
          )}
          {retroPrompt && (
            <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-blue-800">
                  Run rule “{retroPrompt.name}” on {retroScope === 'all' ? 'all transactions' : 'pending transactions'}?
                </p>
                <Select
                  value={retroScope}
                  onChange={(event) => setRetroScope(event.target.value as 'pending' | 'all')}
                  className="w-44"
                  selectSize="sm"
                >
                  <option value="pending">Pending only</option>
                  <option value="all">All historical</option>
                </Select>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => handleRetroRun(retroPrompt.id, retroScope)}
                  disabled={isRetroPending}
                >
                  {isRetroPending && <Spinner className="mr-2 h-3 w-3" />}Run now
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setRetroPrompt(null)
                    setRetroScope('pending')
                  }}
                >
                  Later
                </Button>
              </div>
              <p className="mt-1">We can re-check historical records without reopening completed items.</p>
            </div>
          )}
          <form ref={newRuleFormRef} onSubmit={(event) => handleRuleSubmit(event)} className="space-y-3">
            <Input name="name" placeholder="Rule name" required />
            <Input name="match_description" placeholder="Match description (comma separated keywords)" />
            <Input name="match_transaction_type" placeholder="Match transaction type" />
            <div className="grid grid-cols-2 gap-2">
              <Input name="match_min_amount" placeholder="Min amount" type="number" step="0.01" />
              <Input name="match_max_amount" placeholder="Max amount" type="number" step="0.01" />
            </div>
            <Select name="match_direction" defaultValue="both">
              <option value="both">Any direction</option>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </Select>
            <Select name="auto_status" defaultValue="no_receipt_required">
              <option value="no_receipt_required">Mark as not required</option>
              <option value="auto_completed">Mark as auto completed</option>
              <option value="completed">Mark as completed</option>
              <option value="pending">Leave pending</option>
            </Select>
            <Input name="set_vendor_name" placeholder="Set vendor name (optional)" />
            <Select name="set_expense_category" defaultValue="">
              <option value="">Leave expense unset</option>
              {expenseCategoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            <Button type="submit" disabled={!canManageReceipts || (isRulePending && activeRuleId === 'new')}>
              {isRulePending && activeRuleId === 'new' && <Spinner className="mr-2 h-4 w-4" />}Create rule
            </Button>
          </form>
        </Card>

        <div className="space-y-3">
          {rules.length === 0 && (
            <p className="text-sm text-gray-500">No automation rules yet. Start by adding keywords for things like card settlements.</p>
          )}
          {rules.map((rule) => (
            <Card
              key={rule.id}
              variant="bordered"
              header={<div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                  <p className="text-xs text-gray-500">{rule.description ?? 'Matches: ' + (rule.match_description ?? 'any')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingRuleId((current) => current === rule.id ? null : rule.id)}
                    disabled={isRulePending && activeRuleId === rule.id || !canManageReceipts}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRetroRun(rule.id, 'all')}
                    disabled={!rule.is_active || isRetroPending || !canManageReceipts}
                    title={rule.is_active ? 'Run this rule across all historical transactions' : 'Enable the rule before running it'}
                    className="flex items-center gap-1"
                  >
                    {isRetroPending && retroRuleId === rule.id ? (
                      <>
                        <Spinner className="h-4 w-4" />
                        <span>Running…</span>
                      </>
                    ) : (
                      'Run historical'
                    )}
                  </Button>
                  <Button
                    variant={rule.is_active ? 'success' : 'ghost'}
                    size="sm"
                    onClick={() => handleRuleToggle(rule)}
                    disabled={isRulePending && activeRuleId === rule.id || !canManageReceipts}
                  >
                    {isRulePending && activeRuleId === rule.id ? <Spinner className="h-4 w-4" /> : rule.is_active ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRuleDelete(rule.id)}
                    disabled={isRulePending && activeRuleId === rule.id || !canManageReceipts}
                  >
                    Delete
                  </Button>
                </div>
              </div>}
            >
              {editingRuleId === rule.id && (
                <form onSubmit={(event) => handleRuleSubmit(event, rule.id)} className="space-y-3">
                  <Input name="name" defaultValue={rule.name} required />
                  <Input name="match_description" defaultValue={rule.match_description ?? ''} />
                  <Input name="match_transaction_type" defaultValue={rule.match_transaction_type ?? ''} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="match_min_amount" type="number" step="0.01" defaultValue={rule.match_min_amount ?? ''} />
                    <Input name="match_max_amount" type="number" step="0.01" defaultValue={rule.match_max_amount ?? ''} />
                  </div>
                  <Select name="match_direction" defaultValue={rule.match_direction}>
                    <option value="both">Any direction</option>
                    <option value="out">Money out</option>
                    <option value="in">Money in</option>
                  </Select>
                  <Select name="auto_status" defaultValue={rule.auto_status}>
                    <option value="no_receipt_required">Mark as not required</option>
                    <option value="auto_completed">Mark as auto completed</option>
                    <option value="completed">Mark as completed</option>
                    <option value="pending">Leave pending</option>
                  </Select>
                  <Input name="set_vendor_name" defaultValue={rule.set_vendor_name ?? ''} placeholder="Set vendor name (optional)" />
                  <Select name="set_expense_category" defaultValue={rule.set_expense_category ?? ''}>
                    <option value="">Leave expense unset</option>
                    {expenseCategoryOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </Select>
                  <Button type="submit" disabled={isRulePending && activeRuleId === rule.id}>
                    {isRulePending && activeRuleId === rule.id && <Spinner className="mr-2 h-4 w-4" />}Save changes
                  </Button>
                </form>
              )}
              {editingRuleId !== rule.id && (
                <div className="space-y-1 text-xs text-gray-500">
                  <p>Direction: {rule.match_direction}</p>
                  {rule.match_min_amount != null && <p>Min amount: £{rule.match_min_amount.toFixed(2)}</p>}
                  {rule.match_max_amount != null && <p>Max amount: £{rule.match_max_amount.toFixed(2)}</p>}
                  <p>Outcome: {statusLabels[rule.auto_status]}</p>
                  {rule.set_vendor_name && <p>Sets vendor: {rule.set_vendor_name}</p>}
                  {rule.set_expense_category && <p>Sets expense: {rule.set_expense_category}</p>}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </Card>
  )
}
