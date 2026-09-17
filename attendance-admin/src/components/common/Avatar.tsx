/**
 * src/components/common/Avatar.tsx
 *
 * Initials by default, everywhere. A person's actual photo only shows when
 * the caller explicitly opts in with showPhoto (see PhotoUpload.tsx, the
 * one place that does) — every list, table, card, and dashboard row uses
 * this same component but stays initials-only, on purpose: seeing someone's
 * face should require opening their own record, not just scanning a list
 * they happen to appear in.
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
  /**
   * Shows the actual photo instead of initials when true. Defaults to
   * false — every list/table/row context (employee list, task cards,
   * corrections, audit log, dashboards) uses initials-only by design, so a
   * person's face only appears on their own profile/detail view
   * (PhotoUpload.tsx, which explicitly opts in) and nowhere else. This
   * keeps a consistent, private-by-default surface: seeing someone's photo
   * requires opening their record, not just scanning a list they happen to
   * be in.
   */
  showPhoto?: boolean;
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
  showPhoto = false,
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

  if (showPhoto && photoUrl && !failed) {
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