import clsx from 'clsx'
import React from 'react'

interface SpoonjoyLogoProps extends React.SVGProps<SVGSVGElement> {
  /** Size of the logo (default: 24) */
  size?: number | string
  /** Color variant - uses currentColor by default */
  variant?: 'current' | 'black' | 'white'
}

/**
 * The Spoonjoy logo - the app's abstract signature mark.
 * Uses currentColor by default so it inherits text color from parent.
 * This is a filled logo (not stroke-based like lucide icons), so we use
 * fill! to override the fill-none that might be applied by navbar/sidebar.
 */
export function SpoonjoyLogo({ 
  size = 24, 
  variant = 'current',
  className,
  style,
  ...props
}: SpoonjoyLogoProps) {
  const fillColor = variant === 'current'
    ? 'currentColor'
    : variant === 'black'
      ? 'var(--sj-charcoal)'
      : 'var(--sj-bone)'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 500 300"
      // Use fill-current! to override any fill-none from parent components
      // This logo uses fill (not stroke) unlike lucide icons
      className={clsx('shrink-0 fill-current!', className)}
      data-slot="icon"
      style={variant === 'current' ? style : { ...style, color: fillColor }}
      {...props}
    >
      <g fillRule="evenodd" stroke="none" strokeWidth="1">
        <path
          d="M300 100h-62.135c-12.924.042-17.702 1.431-22.518 4.007-4.889 2.615-8.725 6.451-11.34 11.34-2.615 4.89-4.007 9.738-4.007 23.111V200h61.542c13.373 0 18.222-1.392 23.11-4.007 4.89-2.615 8.726-6.451 11.341-11.34 2.615-4.89 4.007-9.738 4.007-23.111V100zm100 84.625c0 40.119-4.177 54.666-12.021 69.333-7.844 14.667-19.354 26.177-34.02 34.021C339.29 295.823 324.743 300 284.624 300H38.458c-13.373 0-18.222-1.392-23.11-4.007-4.89-2.615-8.726-6.451-11.341-11.34-2.576-4.816-3.965-9.594-4.006-22.518L0 200h100v-84.625c0-40.119 4.177-54.666 12.021-69.333 7.844-14.667 19.354-26.177 34.02-34.021C160.71 4.177 175.257 0 215.376 0h246.167c13.373 0 18.222 1.392 23.11 4.007 4.89 2.615 8.726 6.451 11.341 11.34 2.615 4.89 4.007 9.738 4.007 23.111V100H400v84.625z"
        />
      </g>
    </svg>
  )
}
