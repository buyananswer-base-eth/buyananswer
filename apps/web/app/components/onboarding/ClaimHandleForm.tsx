// SPDX-License-Identifier: MIT
// Claim-handle step. The handle is validated client-side with the SAME rule the server enforces
// (app/lib/handle.ts, a mirror) for instant feedback, but the server is authoritative: it re-validates,
// blocks reserved names, and owns uniqueness. The full error matrix is mapped to friendly copy —
// taken / reserved / invalid / already-claimed / session-expired / network. Handle is IMMUTABLE after
// claim (ADR-0022), stated up front.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ME_QUERY_KEY } from "../../hooks/useMe";
import { ApiError, NetworkError, postClaimHandle } from "../../lib/api";
import { validateHandle } from "../../lib/handle";
import formStyles from "../forms.module.css";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";

interface MappedError {
  message: string;
  /** When true, the wallet already has a profile — send them to the editor. */
  alreadyClaimed?: boolean;
  sessionExpired?: boolean;
}

function mapClaimError(err: unknown): MappedError {
  if (err instanceof ApiError) {
    if (err.status === 401)
      return { message: "Your session expired — sign in again.", sessionExpired: true };
    if (err.code === "already_claimed") {
      return { message: "You already have a profile.", alreadyClaimed: true };
    }
    if (err.code === "handle_taken") return { message: "That handle is taken — try another." };
    if (err.code === "handle_reserved")
      return { message: "That handle is reserved — try another." };
    if (err.code === "validation_error") return { message: "That handle isn't valid." };
    return { message: err.message };
  }
  if (err instanceof NetworkError) return { message: err.message };
  if (err instanceof Error) return { message: err.message };
  return { message: "Couldn't claim that handle. Please try again." };
}

export function ClaimHandleForm() {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [touched, setTouched] = useState(false);
  const [host, setHost] = useState("buyananswer.com");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => setHost(window.location.host), []);

  const v = validateHandle(handle);
  const clientError = touched && handle.length > 0 && !v.ok ? v.reason : undefined;

  const claim = useMutation({
    mutationFn: () => {
      if (!v.ok) throw new Error(v.reason);
      const name = displayName.trim();
      return postClaimHandle(name ? { handle: v.handle, displayName: name } : { handle: v.handle });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      navigate("/settings/profile?welcome=1");
    },
    onError: async (err) => {
      const mapped = mapClaimError(err);
      if (mapped.alreadyClaimed) {
        await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        navigate("/settings/profile");
      }
    },
  });

  const serverError = claim.isError ? mapClaimError(claim.error) : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!v.ok) return;
    claim.mutate();
  }

  return (
    <Card>
      <form className={formStyles.form} onSubmit={onSubmit} noValidate>
        <div className="stack">
          <h1 className="panel-title">Claim your handle</h1>
          <p className="muted">
            This is your public link — <code>{host}/your-handle</code>. Pick it carefully:{" "}
            <strong>your handle is permanent</strong> and can't be changed later.
          </p>
        </div>

        <Input
          label="Handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="yourname"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          error={clientError}
          hint={
            !clientError && v.ok
              ? `Your link will be ${host}/${v.handle}`
              : "3–30 characters: lowercase letters, numbers, and underscores."
          }
        />

        <Input
          label="Display name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          maxLength={50}
          hint="Shown on your board. You can change this anytime."
        />

        {serverError ? (
          <p className="form-error" role="alert">
            {serverError.message}
          </p>
        ) : null}

        <div className={formStyles.actions}>
          <Button type="submit" isLoading={claim.isPending} disabled={touched && !v.ok}>
            Claim handle
          </Button>
        </div>
      </form>
    </Card>
  );
}
