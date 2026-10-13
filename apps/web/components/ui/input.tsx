import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-[52px] w-full min-w-0 rounded-full border border-transparent bg-[rgba(30,34,70,0.045)] px-5 text-base text-ink transition-shadow outline-none placeholder:font-light placeholder:text-[#5b6485] focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(91,110,255,0.14),0_8px_24px_rgba(30,34,70,0.08)] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
