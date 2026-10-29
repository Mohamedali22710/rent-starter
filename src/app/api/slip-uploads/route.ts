import { NextResponse } from 'next/server'

import { badRequest, forbidden, getCaller, unauthorized } from '@/lib/auth'
import { uploadSlip } from '@/lib/slip-storage'

/**
 * POST /api/slip-uploads — staff and managers only (tenants may never put
 * files in the slips bucket). Accepts one slip file and stores it in the
 * caller's own organization folder in the private payment-slips bucket,
 * returning the path to give later to POST /api/leases/:leaseId/payments as
 * slipPath.
 *
 * If the payment recording that follows fails (for example over the cap),
 * recordPayment removes the file again so nothing is left behind.
 */
const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
} as const
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: Request) {
  const caller = await getCaller()
  if (caller === null) return unauthorized()
  if (caller.role === 'tenant') return forbidden()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest('Request must be multipart/form-data with a "file" field')
  }
  const file = form.get('file')
  if (!(file instanceof File)) return badRequest('Missing file')

  if (!(file.type in ALLOWED_MIME)) {
    return badRequest('The slip must be a JPEG, PNG or PDF')
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return badRequest('The slip must not be empty and at most 5 MB')
  }

  const extension = ALLOWED_MIME[file.type as keyof typeof ALLOWED_MIME]
  const path = `${caller.orgId}/${crypto.randomUUID()}.${extension}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const result = await uploadSlip(path, bytes, file.type as keyof typeof ALLOWED_MIME)
  if (!result.ok) return badRequest(`Slip upload failed: ${result.error}`)

  return NextResponse.json({ path }, { status: 201 })
}
