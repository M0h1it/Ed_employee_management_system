/**
 * src/components/common/PhotoUpload.tsx
 *
 * Replacing a photograph.
 *
 * The preview is shown from a local object URL BEFORE the upload finishes, so
 * the change feels immediate. If the server rejects the file the preview is
 * dropped and the old photo returns — which is why the previous URL is held
 * rather than overwritten optimistically in the cache.
 */

import { useRef, useState } from 'react';
import Avatar from './Avatar';
import Button from './Button';
import { useToast } from './Toast';
import { getAccessToken } from '@/lib/apiClient';
import { EP } from '@/contracts/endpoints';

const MAX_BYTES = 2 * 1024 * 1024;

interface Props {
  employeeId: string;
  name: string;
  photoUrl: string | null;
  onChange: (photoUrl: string | null) => void;
  /** False when the viewer may not change this person's photo. */
  editable?: boolean;
}

export default function PhotoUpload({
  employeeId,
  name,
  photoUrl,
  onChange,
  editable = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function pick(file: File) {
    // Checked here as well as on the server. The client check is for the
    // person — instant, no upload, clear message. The server check is the one
    // that matters, because this one can be bypassed.
    if (file.size > MAX_BYTES) {
      toast('Photos must be under 2 MB', 'error');
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch(EP.photos.upload(employeeId), {
        method: 'POST',
        // No Content-Type header: the browser sets it, including the multipart
        // boundary. Setting it by hand produces a body the server cannot parse.
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? 'Upload failed');
      }

      const payload = await response.json();
      onChange(payload.data.photoUrl);
      toast('Photo updated', 'success');
    } catch (error) {
      setPreview(null);
      toast(error instanceof Error ? error.message : 'Could not upload the photo', 'error');
    } finally {
      setBusy(false);
      URL.revokeObjectURL(localUrl);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(EP.photos.remove(employeeId), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      setPreview(null);
      onChange(null);
      toast('Photo removed', 'success');
    } catch {
      toast('Could not remove the photo', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-space-base">
      <Avatar name={name} photoUrl={preview ?? photoUrl} size="lg" />

      {editable && (
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs">
            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? 'Uploading…' : photoUrl ? 'Replace' : 'Upload photo'}
            </Button>
            {photoUrl && (
              <Button variant="ghost" onClick={remove} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <span className="font-label-sm text-label-sm text-zinc-400">
            JPEG, PNG or WebP, under 2 MB. Initials are used when there is no photo.
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
      )}
    </div>
  );
}
