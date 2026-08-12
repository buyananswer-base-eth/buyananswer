// SPDX-License-Identifier: MIT
// Avatar upload. Client pre-validates type + size for instant feedback; the server is authoritative
// (it re-checks type, ≤ 5 MB, AND a magic-byte match — FUNCTIONAL_SPEC §3.1). Shows a local preview
// while uploading and the full error matrix (bad type / too large / server / session-expired / network).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ME_QUERY_KEY } from "../../hooks/useMe";
import { ApiError, NetworkError, postAvatar } from "../../lib/api";
import { Avatar } from "../Avatar";
import { Button } from "../ui/Button";
import styles from "./AvatarUploader.module.css";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

function mapAvatarError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Your session expired — sign in again.";
    if (err.code === "unsupported_media_type") return "Use a PNG, JPEG, or WebP image.";
    if (err.code === "file_too_large") return "That image is over 5 MB.";
    if (err.code === "invalid_image") return "That file doesn't look like a valid image.";
    if (err.code === "no_profile") return "Claim a handle first.";
    return err.message;
  }
  if (err instanceof NetworkError) return err.message;
  return "Couldn't upload that image. Please try again.";
}

export function AvatarUploader({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // Revoke the object URL when the preview changes / unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const upload = useMutation({
    mutationFn: (file: File) => postAvatar(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  function onPick(file: File | undefined) {
    setClientError(null);
    upload.reset();
    if (!file) return;
    if (!ALLOWED.has(file.type)) {
      setClientError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError("That image is over 5 MB.");
      return;
    }
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    upload.mutate(file);
  }

  const error = clientError ?? (upload.isError ? mapAvatarError(upload.error) : null);
  const shownSrc = upload.isSuccess ? avatarUrl : (preview ?? avatarUrl);

  return (
    <div className={styles.row}>
      <Avatar src={shownSrc} name={name} size={72} />
      <div className={styles.body}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.hiddenInput}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <div className="row">
          <Button
            variant="secondary"
            size="sm"
            isLoading={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {avatarUrl ? "Change photo" : "Upload photo"}
          </Button>
          {upload.isSuccess && !error ? <span className={styles.ok}>Saved ✓</span> : null}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p className={styles.hint}>PNG, JPEG, or WebP · up to 5 MB</p>
        )}
      </div>
    </div>
  );
}
