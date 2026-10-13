import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-[13px] font-bold tracking-[0.12em] uppercase',
  {
    variants: {
      variant: {
        default: 'bg-[rgba(30,34,70,0.08)] text-ink-soft',
        high: 'bg-good-bg text-good',
        medium: 'bg-warn-bg text-warn',
        low: 'bg-bad-bg text-bad',
        meta: 'bg-[rgba(30,34,70,0.07)] text-label tracking-normal normal-case font-semibold',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
