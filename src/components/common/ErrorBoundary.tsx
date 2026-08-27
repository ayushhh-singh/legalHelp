import { Component, type ErrorInfo, type ReactNode } from 'react'

import { useT } from '@/i18n/useT'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/* React has no hook-based error boundary, so this file must export a class
   component and cannot participate in fast refresh. */
/* eslint-disable react-refresh/only-export-components */

/** Function component so the fallback can use the translation hook. */
function ErrorFallback({ error }: { error: Error }) {
  const { t } = useT()

  return (
    <div role="alert" className="m-4 flex flex-col gap-2 rounded-sm border border-thread/50 bg-thread/5 p-4">
      <h2 className="font-display text-lg text-ink">{t('errors.title')}</h2>
      <p className="text-sm text-ink-2">{t('errors.body')}</p>
      <details className="mt-1 text-xs text-ink-2">
        <summary className="cursor-pointer">{t('errors.details')}</summary>
        <pre className="mt-2 overflow-x-auto font-mono text-xs">{error.message}</pre>
      </details>
    </div>
  )
}

/**
 * Keeps a failing module from blanking the whole shell. Deliberately reports
 * nothing anywhere — no analytics, no network (master context, hard rule).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[sahayak] render error', error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return this.props.fallback ?? <ErrorFallback error={error} />
  }
}
