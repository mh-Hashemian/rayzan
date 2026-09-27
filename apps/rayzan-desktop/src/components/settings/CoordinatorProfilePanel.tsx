import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import {
  fetchCoordinatorProfile,
  removeCoordinatorProfile,
  uploadCoordinatorProfile,
  type CoordinatorProfile,
} from '../../api.js';
import { MarkdownBody } from '../markdown/MarkdownBody.js';

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function CoordinatorProfilePanel() {
  const [profile, setProfile] = useState<CoordinatorProfile | undefined>();
  const [maxCharacters, setMaxCharacters] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await fetchCoordinatorProfile();
      setProfile(state.profile ?? undefined);
      setMaxCharacters(state.maxCharacters);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    try {
      setProfile(
        (await uploadCoordinatorProfile({
          filename: file.name,
          content: await file.text(),
        })) ?? undefined,
      );
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    try {
      await removeCoordinatorProfile();
      setProfile(undefined);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function pickFile(): void {
    fileInput.current?.click();
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Clear so choosing the same file again still fires a change event.
    event.target.value = '';
    if (file !== undefined) {
      void upload(file);
    }
  }

  return (
    <section className="coordinator-profile">
      <h2>Coordinator Profile</h2>
      <p className="lede">
        Optional Markdown guidance for the Coordinator. It shapes how the
        Coordinator runs a Decision and is re-anchored at the start of each
        round. Rayzan's own actions, dispatch rules, checkpoints and protocol
        always stay in force above it.
      </p>

      {error ? (
        <p className="provider-error" role="status">
          {error}
        </p>
      ) : null}

      {profile === undefined ? (
        <p className="coordinator-profile-none" role="status">
          No active profile. The Coordinator uses Rayzan's default behavior.
        </p>
      ) : (
        <>
          <p className="coordinator-profile-current" role="status">
            Current file: <strong>{profile.filename}</strong>
            <span className="coordinator-profile-meta">
              {profile.content.length} of {maxCharacters} characters · updated{' '}
              {formatUpdated(profile.updatedAt)}
            </span>
          </p>
          <p className="coordinator-profile-preview-label">Preview:</p>
          <div className="coordinator-profile-preview">
            <MarkdownBody text={profile.content} tone="secondary" />
          </div>
        </>
      )}

      <div className="coordinator-profile-actions">
        <input
          ref={fileInput}
          type="file"
          accept=".md,text/markdown"
          hidden
          onChange={onFileChosen}
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={pickFile}
        >
          {busy
            ? 'Uploading…'
            : profile === undefined
              ? 'Upload markdown file'
              : 'Replace'}
        </button>
        {profile === undefined ? null : (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}
