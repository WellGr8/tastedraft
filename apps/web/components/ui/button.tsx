import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold whitespace-nowrap transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-3px_0_rgba(0,0,0,0.45)] hover:-translate-y-0.5',
        outline:
          'border border-white/80 bg-white/60 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,1),0_4px_12px_rgba(30,34,70,0.07)] backdrop-blur-md hover:-translate-y-0.5 hover:bg-white',
        ghost: 'bg-transparent text-ink hover:bg-white/70',
        secondary: 'bg-white text-ink shadow-[0_2px_8px_rgba(30,34,70,0.08)] hover:bg-white',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-3.5 text-[13px]',
        lg: 'h-[62px] px-7 text-lg',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
