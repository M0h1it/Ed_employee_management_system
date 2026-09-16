/**
 * src/components/common/Placeholder.tsx
 *
 * Temporary stand-in for screens not built yet. Every route exists from day
 * one so navigation can be tested end to end; each one gets replaced by a real
 * page as its feature is built.
 */

import PageHeader from './PageHeader';

export default function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} description="This screen has not been built yet." />
      <div className="flex h-64 items-center justify-center rounded-xl bg-surface-container-lowest">
        <div className="flex flex-col items-center gap-space-sm text-on-surface-variant">
          <span className="icon text-[32px] text-outline">construction</span>
          <span className="font-body-sm text-body-sm">Coming in a later feature</span>
        </div>
      </div>
    </>
  );
}
