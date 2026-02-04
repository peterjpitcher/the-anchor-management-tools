import { NextResponse } from 'next/server'
import { uploadReceiptForTransaction } from '@/app/actions/receipts'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const result = await uploadReceiptForTransaction(formData)

    if (result?.error) {
      const status = result.error === 'Insufficient permissions' ? 403 : 400
      return NextResponse.json(result, { status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Receipt upload API failed:', error)
    return NextResponse.json({ error: 'Failed to upload receipt file.' }, { status: 500 })
  }
}
