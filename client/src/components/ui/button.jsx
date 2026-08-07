import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-95',
  {
    variants: {
      variant: {
        default:
          'bg-blue-600 text-white shadow-md hover:bg-blue-700 hover:scale-105',
        secondary:
          'bg-white text-slate-700 border border-gray-200 hover:bg-gray-50',
        ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
        hero:
          'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 rounded-lg text-lg font-medium',
        'hero-outline':
          'bg-white text-slate-700 hover:bg-gray-50 rounded-lg text-lg font-medium border border-gray-200',
      },
      size: {
        default: 'h-11 px-6',
        sm: 'h-9 px-4 text-xs',
        lg: 'h-12 px-7 text-base',
        xl: 'h-14 px-10 py-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = 'Button'

export { Button, buttonVariants }
