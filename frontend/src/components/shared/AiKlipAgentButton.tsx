'use client'

import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AiKlipAgentButtonProps = {
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  label?: string
  title?: string
  layout?: 'inline' | 'stacked'
  className?: string
}

export function AiKlipAgentButton({
  onClick,
  loading = false,
  disabled = false,
  label = 'AI Klip Agent',
  title,
  layout = 'inline',
  className,
}: AiKlipAgentButtonProps) {
  const isStacked = layout === 'stacked'
  const buttonTitle = title ?? label

  return (
    <Button
      type="button"
      variant="outline"
      size={isStacked ? 'default' : 'sm'}
      onClick={onClick}
      disabled={disabled || loading}
      title={buttonTitle}
      className={cn(
        'gap-1.5 border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 hover:text-violet-900',
        isStacked
          ? 'h-full min-h-[4.75rem] flex-col justify-center px-3 py-3'
          : 'h-8',
        className,
      )}
    >
      {loading ? (
        <Loader2
          className={cn('animate-spin shrink-0', isStacked ? 'h-4 w-4' : 'h-3.5 w-3.5')}
          aria-hidden
        />
      ) : (
        <Sparkles
          className={cn('shrink-0', isStacked ? 'h-4 w-4' : 'h-3.5 w-3.5')}
          aria-hidden
        />
      )}
      <span className={cn('font-medium text-center leading-tight', isStacked ? 'text-xs' : 'text-xs')}>
        {label}
      </span>
    </Button>
  )
}
