import React, { Component, ErrorInfo, ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * Error Boundary Component
 * Catches errors in child components and displays a fallback UI
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  }

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    console.error('🔥 [ErrorBoundary] Uncaught error:', error, errorInfo)

    // Detect chunk load failures (common after a new deployment)
    // "Failed to fetch dynamically imported module" or "Loading chunk X failed"
    const errorMsg = error?.message || ''
    const isChunkLoadError = /failed to fetch dynamically imported module|loading chunk|valid JavaScript MIME type|Unexpected token '<'/i.test(errorMsg)

    if (isChunkLoadError) {
      console.warn('🔄 [ErrorBoundary] Chunk load failed detected. Forcing page refresh in 2 seconds...')
      // Give the user a moment to see something (or just do it if it's a white screen)
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    }

    // Update state with error details
    this.setState({
      error,
      errorInfo
    })

    // Send to Sentry (no-op if VITE_SENTRY_DSN not configured)
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    })
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
    
    // Optionally reload the page
    window.location.reload()
  }

  private handleGoHome = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
    
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-secondary/30 p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-destructive/10 rounded-lg flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <CardTitle>Something went wrong</CardTitle>
                  <CardDescription>
                    The application encountered an unexpected error
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm font-medium mb-2">Error Details:</p>
                  <p className="text-sm text-muted-foreground font-mono break-all">
                    {this.state.error?.message || 'Unknown error'}
                  </p>
                </div>

                {import.meta.env.DEV && this.state.errorInfo && (
                  <details className="rounded-lg bg-muted p-4">
                    <summary className="text-sm font-medium cursor-pointer mb-2">
                      Stack Trace (Development Only)
                    </summary>
                    <pre className="text-xs text-muted-foreground overflow-auto max-h-40">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}

                <div className="text-sm text-muted-foreground">
                  <p className="mb-2">You can try:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Refreshing the page</li>
                    <li>Going back to the homepage</li>
                    <li>Clearing your browser cache</li>
                  </ul>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button onClick={this.handleReset} variant="default" className="flex-1">
                Reload Page
              </Button>
              <Button onClick={this.handleGoHome} variant="outline" className="flex-1">
                Go to Homepage
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

