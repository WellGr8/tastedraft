import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-[120px] w-full resize-y rounded-3xl border border-transparent bg-[rgba(30,34,70,0.045)] px-5 py-4 text-lg leading-relaxed text-ink transition-shadow outline-none placeholder:font-light placeholder:text-[#5b6485] focus-visible:bg-white focus-visible:shadow-[0_0_0_4px_rgba(91,110,255,0.14),0_8px_24px_rgba(30,34,70,0.08)]',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
