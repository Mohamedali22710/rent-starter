import { createClient } from '@supabase/supabase-js'

/**
 * Server-side access to the private payment-slips bucket. Uses the service
 * role key and is therefore only ever imported into server code; the key must
 * never reach the browser. Direct Data-API/Storage access from users goes
 * through the bucket's own RLS policies (staff/managers of the org only).
 */

const BUCKET = 'payment-slips'

function storage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SECRET_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  return supabase.storage.from(BUCKET)
}

/** True when an object exists at `path` (`<org_id>/...`) in the bucket. */
export async function slipExists(path: string): Promise<boolean> {
  const segments = path.split('/').filter((s) => s !== '')
  if (segments.length < 2) return false
  const folder = segments.slice(0, -1).join('/')
  const fileName = segments[segments.length - 1]
  const { data, error } = await storage().list(folder, { search: fileName, limit: 100 })
  if (error !== null) return false
  return data.some((object) => object.id !== null && object.name === fileName)
}

/** Remove an uploaded slip (used when the payment record fails after upload). */
export async function deleteSlip(path: string): Promise<void> {
  await storage().remove([path])
}
