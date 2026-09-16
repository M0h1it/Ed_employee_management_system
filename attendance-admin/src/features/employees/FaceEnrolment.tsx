/**
 * src/features/employees/FaceEnrolment.tsx
 *
 * Uploads a photo for the kiosk's face matcher — separate from PhotoUpload
 * (the profile picture shown everywhere in the app). The two can end up
 * being different photos entirely: a profile picture might be a posed studio
 * shot, while the kiosk wants a plain, well-lit, front-on face the matcher
 * can build a reliable template from.
 *
 * WHY THIS IS ITS OWN MODULE, NOT PART OF PhotoUpload
 * ------------------------------------------------------
 * Different permission (face.enrol, not employees.edit — see
 * PHASE-3-BRIEF.md's consent requirement), different endpoint, and a
 * genuinely different response shape: the server runs a face-quality check
 * (exactly one face, large enough, not blurred) and reports back a quality
 * score and how many templates the employee now has, capped at 5. A failed
 * upload here means "try a clearer photo", not "upload failed" — the error
 * messages below are written for that distinction.
 */

import { useRef, useState } from 'react';
import Button from '@/components/common/Button';
import { useToast } from '@/components/common/Toast';
import { getAccessToken } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Mirrors QUALITY_MESSAGES in app/api/v1/face.py. Kept as a lookup here too
 * rather than only trusting the server's message string, so a network-level
 * failure (no body at all) still shows something specific rather than a bare
 * "Upload failed".
 */
const QUALITY_MESSAGES: Record<string, string> = {
  UNREADABLE_IMAGE: 'That file could not be read as an image.',
  NO_FACE_FOUND: 'No face was found in this photo.',
  MULTIPLE_FACES: 'More than one face was found in this photo. Use a photo of one person only.',
  FACE_TOO_SMALL: 'The face is too small in this photo. Move closer or crop tighter.',
  LOW_QUALITY: 'This photo is too unclear to enrol. Try better lighting and a straight-on angle.',
};

interface EnrolResult {
  employeeId: string;
  templateCount: number;
  qualityScore: number;
}

interface Props {
  employeeId: string;
  /** From Employee.faceEnrolled — whether at least one template exists today. */
  enrolled: boolean;
  /** Called after a successful upload, so the caller can invalidate the
   * employee list/detail caches the same way PhotoUpload's onChange does. */
  onEnrolled: () => void;
  /** False when the viewer may not enrol this person — face.enrol, not
   * employees.edit, per the consent requirement in PHASE-3-BRIEF.md. */
  editable?: boolean;
}

export default function FaceEnrolment({ employeeId, enrolled, onEnrolled, editable = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lastQuality, setLastQuality] = useState<number | null>(null);
  const toast = useToast();

  async function pick(file: File) {
    // Same reasoning as PhotoUpload: this check is for the person (instant,
    // no round trip). The server's own MAX_UPLOAD_BYTES check is the one
    // that actually matters, because this one can be bypassed.
    if (file.size > MAX_BYTES) {
      toast('That photo is too large — please use one under 5 MB', 'error');
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch(EP.face.enrol(employeeId), {
        method: 'POST',
        // No Content-Type: the browser sets the multipart boundary itself —
        // setting it by hand produces a body the server cannot parse, the
        // same trap PhotoUpload avoids.
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const code = payload?.error?.code as string | undefined;
        const message =
          (code && QUALITY_MESSAGES[code]) ??
          payload?.error?.message ??
          'Could not enrol this photo.';
        toast(message, 'error');
        return;
      }

      const result = payload.data as EnrolResult;
      setLastQuality(result.qualityScore);
      onEnrolled();
      toast(
        enrolled ? 'Added another face template' : 'Face enrolled for kiosk check-in',
        'success',
      );
    } catch {
      toast('Could not reach the server. Check your connection and try again.', 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (!editable) return null;

  return (
    <div className="flex flex-col gap-space-xs rounded-2xl border border-black/[0.06] bg-zinc-50 px-space-md py-space-sm">
      <div className="flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <span
            className={
              enrolled
                ? 'icon text-[18px] text-emerald-600'
                : 'icon text-[18px] text-zinc-400'
            }
          >
            {enrolled ? 'verified_user' : 'face'}
          </span>
          <div className="flex flex-col">
            <span className="font-label-md text-label-md text-zinc-900">
              Kiosk face recognition
            </span>
            <span className="font-label-sm text-label-sm text-zinc-400">
              {enrolled
                ? 'This person can check in at the kiosk with their face.'
                : 'Not enrolled — the kiosk cannot recognise this person yet.'}
            </span>
          </div>
        </div>

        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Checking photo…' : enrolled ? 'Add another photo' : 'Enrol face'}
        </Button>
      </div>

      {lastQuality !== null && (
        <span className="font-label-sm text-label-sm text-zinc-400">
          Last upload quality: {Math.round(lastQuality * 100)}%
        </span>
      )}

      <span className="font-label-sm text-label-sm text-zinc-400">
        One clear, front-on photo — one face only, well lit, under 5 MB. The photo itself is
        never stored; only a mathematical template is kept, and it is deleted if enrolment is
        withdrawn.
      </span>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
        }}
      />
    </div>
  );
}