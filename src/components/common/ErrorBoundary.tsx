import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/useT'

/* React has no hook-based error boundary, so this file must export a class
   component alongside its function fallback. eslint-plugin-react-refresh 0.5
   no longer flags that pairing, so there is no disable directive here. */

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /**
   * Changing this clears the error. The shell passes the current path, so a
   * failed route (a lazy chunk missing after a redeploy, most likely) does not
   * leave the whole app stuck on the error screen until a full reload.
   */
  resetKey?: string | number
}

interface State {
  error: Error | null
  resetKey: string | number | undefined
}

/** Function component so the fallback can use the translation hook. */
function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useT()

  return (
    <div role="alert" className="m-4 flex flex-col gap-3 rounded-lg border border-coral/30 bg-coral/15 p-4">
      <div className="flex items-center gap-2 text-coral-foreground">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        <h2 className="text-base font-semibold">{t('errors.title')}</h2>
      </div>
      <p className="text-sm text-coral-foreground">{t('errors.body')}</p>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
      <details className="text-xs text-coral-foreground">
        <summary className="cursor-pointer">{t('errors.details')}</summary>
        <pre className="mt-2 overflow-x-auto text-xs">{error.message}</pre>
      </details>
    </div>
  )
}

/**
 * Keeps a failing module from blanking the whole shell. Deliberately reports
 * nothing anywhere — no analytics, no network (master context, hard rule).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: undefined }

  constructor(props: Props) {
    super(props)
    this.state = { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /** Clear the error when the caller signals a new context (e.g. a new route). */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }
    return null
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[sahayak] render error', error, info.componentStack)
  }

  private readonly retry = () => {
    this.setState({ error: null })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return this.props.fallback ?? <ErrorFallback error={error} onRetry={this.retry} />
  }
}
