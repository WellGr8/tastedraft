import { Suspense } from 'react';
import { TasteDraft } from '@/components/taste-draft';

export default function Page() {
  return (
    <Suspense fallback={<div className="td-canvas min-h-screen" />}>
      <TasteDraft />
    </Suspense>
  );
}
