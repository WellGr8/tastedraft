import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('td-glass flex min-w-0 flex-col gap-4 rounded-[28px] p-5 sm:p-6', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-title"
      className={cn('text-xs font-semibold tracking-[0.14em] text-slate uppercase', className)}
      {...props}
    />
  );
}

export { Card, CardTitle };
