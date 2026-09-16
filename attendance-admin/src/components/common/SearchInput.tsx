/**
 * src/components/common/SearchInput.tsx
 *
 * Text input with a debounce built in.
 *
 * WHY DEBOUNCE: without it, typing "engineering" fires twelve requests, and
 * they can come back out of order — so the results for "engineer" may land
 * after the results for "engineering" and overwrite them. 300ms of quiet
 * before firing removes both problems.
 */

import { useEffect, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  delay = 300,
}: Props) {
  const [local, setLocal] = useState(value);

  // Keep the box responsive while delaying the callback.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (local !== value) onChange(local);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  // If the parent resets the filter, reflect that here.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className="relative">
      <span className="icon pointer-events-none absolute left-space-sm top-1/2 -translate-y-1/2 text-[16px] text-zinc-400">
        search
      </span>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        className="h-9 w-full rounded-xl bg-zinc-50 pl-8 pr-space-md font-body-sm text-body-sm text-zinc-900 outline-none ring-indigo-200 placeholder:text-zinc-400 focus:ring-2"
      />
    </div>
  );
}
