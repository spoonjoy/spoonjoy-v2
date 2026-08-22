/**
 * Catalyst Link component integrated with React Router for client-side navigation.
 * 
 * - Internal links use React Router's Link for SPA navigation
 * - External links (http://, https://, //) open in new tab with security attributes
 * - Supports all standard anchor attributes
 * 
 * Based on Catalyst documentation:
 * https://catalyst.tailwindui.com/docs#client-side-router-integration
 */

import * as Headless from '@headlessui/react'
import { Link as RouterLink } from 'react-router'
import React, { forwardRef } from 'react'

/**
 * Check if a URL is external (should open in new tab)
 */
function isExternalUrl(href: string | undefined): boolean {
  if (!href) return false
  
  // Protocol-relative URLs (//example.com)
  if (href.startsWith('//')) return true
  
  // Absolute URLs with protocol
  if (href.startsWith('http://') || href.startsWith('https://')) return true
  
  return false
}

/**
 * Check if a URL should use React Router (internal navigation)
 */
function isInternalUrl(href: string | undefined): boolean {
  if (!href) return false
  
  // External URLs should not use router
  if (isExternalUrl(href)) return false
  
  // Special protocols should use native anchor
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return false
  
  // Everything else is internal
  return true
}

export interface LinkProps extends React.ComponentPropsWithoutRef<'a'> {
  href: string
  reloadDocument?: boolean
}

export const Link = forwardRef(function Link(
  { href, target, rel, reloadDocument, ...props }: LinkProps,
  ref: React.ForwardedRef<HTMLAnchorElement>
) {
  const isExternal = isExternalUrl(href)
  const isInternal = isInternalUrl(href)
  
  // For external links, default to new tab with security attributes
  // unless explicitly overridden
  const externalProps = isExternal
    ? {
        target: target ?? '_blank',
        rel: rel ?? 'noopener noreferrer',
      }
    : { target, rel }
  
  // Use React Router Link for internal navigation (SPA-style)
  if (isInternal) {
    return (
      <Headless.DataInteractive>
        <RouterLink
          to={href}
          ref={ref}
          reloadDocument={reloadDocument}
          {...externalProps}
          {...props}
        />
      </Headless.DataInteractive>
    )
  }
  
  // Use native anchor for external links and special protocols
  return (
    <Headless.DataInteractive>
      <a
        href={href}
        ref={ref}
        {...externalProps}
        {...props}
      />
    </Headless.DataInteractive>
  )
})
