import { formatCurrencySync } from '@/lib/utils'

export interface CheckOutPayment {
    amount: number
    method: string
}

interface CheckOutPaymentFieldsProps {
    /** What the guest still owes — room + charges, less anything already paid. */
    balanceDue: number
    amount: string
    method: string
    onAmountChange: (value: string) => void
    onMethodChange: (value: string) => void
    currency: string
    disabled?: boolean
}

/**
 * The money taken at the desk as a guest leaves.
 *
 * Every check-out surface shows this so the payment is recorded where it
 * happens. Check-out used to record nothing at all — it displayed the balance,
 * took the cash and wrote neither a payment event nor an updated amountPaid —
 * which left the collection invisible to the staff revenue reports.
 *
 * The amount is prefilled with the balance due (the usual case) and stays
 * editable, because what gets recorded has to be what was actually collected.
 */
export function CheckOutPaymentFields({
    balanceDue,
    amount,
    method,
    onAmountChange,
    onMethodChange,
    currency,
    disabled = false,
}: CheckOutPaymentFieldsProps) {
    if (balanceDue <= 0) return null

    const collected = amount === '' ? balanceDue : Math.max(0, parseFloat(amount) || 0)

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-900">Payment collected now</p>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="text-xs text-amber-800" htmlFor="checkout-amount">Amount</label>
                    <input
                        id="checkout-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full h-9 rounded-md border border-amber-300 bg-white px-2 text-sm"
                        value={amount === '' ? String(balanceDue) : amount}
                        onChange={(e) => onAmountChange(e.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div>
                    <label className="text-xs text-amber-800" htmlFor="checkout-method">Method</label>
                    <select
                        id="checkout-method"
                        className="w-full h-9 rounded-md border border-amber-300 bg-white px-2 text-sm"
                        value={method}
                        onChange={(e) => onMethodChange(e.target.value)}
                        disabled={disabled}
                    >
                        <option value="cash">💵 Cash</option>
                        <option value="mobile_money">📱 Mobile Money</option>
                        <option value="card">💳 Card</option>
                        <option value="not_paid">⏳ Nothing collected</option>
                    </select>
                </div>
            </div>
            {method !== 'not_paid' && collected !== balanceDue && (
                <p className="text-xs text-amber-700">
                    {collected < balanceDue
                        ? `Leaves ${formatCurrencySync(balanceDue - collected, currency)} outstanding.`
                        : `${formatCurrencySync(collected - balanceDue, currency)} more than the balance due.`}
                </p>
            )}
        </div>
    )
}

/** What to hand the check-out call, given the field values. */
export function buildCheckOutPayment(
    balanceDue: number,
    amount: string,
    method: string
): CheckOutPayment {
    if (balanceDue <= 0 || method === 'not_paid') return { amount: 0, method }
    return {
        amount: amount === '' ? balanceDue : Math.max(0, parseFloat(amount) || 0),
        method,
    }
}
