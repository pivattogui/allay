import { Check } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, _ref) => {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className={cn(
          'peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked && 'bg-primary text-primary-foreground',
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
        {...(props as any)}
      >
        {checked && <Check className="h-3 w-3 mx-auto" />}
      </button>
    )
  },
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
