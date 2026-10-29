import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Not found</h1>
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Back to your area
        </Link>
      </div>
    </main>
  )
}
