import type React from 'react'

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="sj-page flex min-h-dvh flex-col p-3">
      <div className="flex grow items-center justify-center p-4 sm:p-6 lg:p-10">
        <section className="sj-panel relative w-full max-w-md overflow-hidden rounded-[2rem] p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-[color-mix(in_srgb,var(--sj-brass)_22%,transparent)] blur-3xl" aria-hidden="true" />
          {children}
        </section>
      </div>
    </main>
  )
}
