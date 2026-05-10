import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React from 'react'
import { Text } from './text'

const sizes = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  '5xl': 'sm:max-w-5xl',
}

export function Dialog({
  size = 'lg',
  className,
  children,
  ...props
}: { size?: keyof typeof sizes; className?: string; children: React.ReactNode } & Omit<
  Headless.DialogProps,
  'as' | 'className'
>) {
  return (
    <Headless.Dialog {...props}>
      <Headless.DialogBackdrop
        transition
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-[60] flex w-screen justify-center overflow-y-auto bg-zinc-950/35 px-2 py-2 backdrop-blur-sm transition data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in data-closed:opacity-0 data-enter:data-closed:opacity-0 motion-reduce:transition-none focus:outline-0 sm:px-6 sm:py-8 lg:px-8 lg:py-16"
      />

      <div className="fixed inset-0 z-[60] w-screen overflow-y-auto pt-6 sm:pt-0">
        <div className="grid min-h-full grid-rows-[1fr_auto] justify-items-center sm:grid-rows-[1fr_auto_3fr] sm:p-4">
          <Headless.DialogPanel
            transition
            data-slot="dialog-panel"
            className={clsx(
              sizes[size],
              'row-start-2 w-full min-w-0 rounded-t-[2rem] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-(--gutter) shadow-[var(--sj-shadow)] [--gutter:--spacing(8)] sm:mb-auto sm:rounded-[2rem] forced-colors:outline',
              'transition will-change-transform data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in data-closed:translate-y-8 data-closed:opacity-0 data-enter:data-closed:translate-y-8 data-enter:data-closed:opacity-0 sm:data-closed:translate-y-0 sm:data-closed:scale-95 sm:data-enter:data-closed:translate-y-0 sm:data-enter:data-closed:scale-95 motion-reduce:transition-none motion-reduce:data-closed:translate-y-0',
              className
            )}
          >
            {children}
          </Headless.DialogPanel>
        </div>
      </div>
    </Headless.Dialog>
  )
}

export const DialogTitle = React.forwardRef<HTMLElement, { className?: string } & Omit<Headless.DialogTitleProps, 'as' | 'className'>>(
  function DialogTitle({ className, ...props }, ref) {
    return (
      <Headless.DialogTitle
        {...props}
        ref={ref}
        className={clsx(className, 'font-sj-display text-lg/6 font-semibold text-balance text-[var(--sj-ink)] sm:text-base/6')}
      />
    )
  }
)

DialogTitle.displayName = 'DialogTitle'

export function DialogDescription({
  className,
  ...props
}: { className?: string } & Omit<Headless.DescriptionProps<typeof Text>, 'as' | 'className'>) {
  return <Headless.Description as={Text} {...props} className={clsx(className, 'mt-2 text-pretty')} />
}

export function DialogBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'mt-6')} />
}

export function DialogActions({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        'mt-8 flex flex-col-reverse items-center justify-end gap-3 *:w-full sm:flex-row sm:*:w-auto'
      )}
    />
  )
}
