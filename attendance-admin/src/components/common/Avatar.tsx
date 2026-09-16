/**
 * src/components/common/Avatar.tsx
 *
 * Photo if there is one, initials if there is not.
 *
 * WHY A COMPONENT AND NOT A DIV EACH TIME: twelve of the twelve employees in
 * the fixtures have photoUrl null, and in production plenty will too. The
 * fallback has to exist everywhere an avatar appears — building it once means
 * it cannot be forgotten on the eleventh screen.
 */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { initials } from '@/lib/format';

interface Props {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Squircle matches the design; circle is for the sidebar footer. */
  shape?: 'squircle' | 'circle';
}

const SIZES = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-7 w-7 text-[11px]',
  lg: 'h-14 w-14 text-[18px]',
};

export default function Avatar({
  name,
  photoUrl,
  size = 'md',
  shape = 'squircle',
}: Props) {
  const radius = shape === 'circle' ? 'rounded-[50%]' : 'rounded-xl';

  /**
   * Falls back to initials when the image will not load.
   *
   * A stored path can outlive its file — a redeploy that did not carry the
   * uploads directory, a manual delete, a proxy that is not forwarding
   * /uploads. Without this the page shows a browser's broken-image icon, which
   * looks like a bug in the design rather than a missing file.
   *
   * Reset when the URL changes, so replacing a photo that previously failed
   * gets a fresh attempt rather than staying on initials forever.
   */
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        onError={() => setFailed(true)}
        className={clsx(SIZES[size], radius, 'shrink-0 object-cover')}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={clsx(
        SIZES[size],
        radius,
        'flex shrink-0 items-center justify-center bg-indigo-600 font-label-sm text-white',
      )}
    >
      {initials(name)}
    </div>
  );
}
