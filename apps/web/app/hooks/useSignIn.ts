// SPDX-License-Identifier: MIT
// The SIWE sign-in flow, wired to the API: nonce → build message → wallet signature → verify → the
// API sets the session cookie → refetch `/me`. Exposes a step for the loading sub-states (§10) and a
// friendly error string that distinguishes a rejected signature, an expired nonce, and network/server
// failures.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ApiError, NetworkError, getNonce, postVerify } from "../lib/api";
import { isSupportedChainId } from "../lib/chains";
import { buildSiweMessage } from "../lib/siwe";
import { ME_QUERY_KEY } from "./useMe";

/** Sub-states of the sign-in flow, for granular loading UI. */
export type SignInStep = "idle" | "nonce" | "awaiting-signature" | "verifying";

function toFriendlyError(err: unknown): string {
  if (err instanceof Error && /reject|denied|user\s?refused/i.test(`${err.name} ${err.message}`)) {
    return "You declined the signature request.";
  }
  if (err instanceof ApiError) {
    if (err.code === "invalid_nonce") return "Your sign-in request expired — please try again.";
    if (err.code === "unsupported_chain") return "Switch to Base or Base Sepolia and try again.";
    if (err.code === "siwe_failed") return "We couldn't verify that signature. Please try again.";
    return err.message;
  }
  if (err instanceof NetworkError) return err.message;
  return "Something went wrong signing in. Please try again.";
}

export interface UseSignIn {
  signIn: () => Promise<void>;
  step: SignInStep;
  error: string | null;
  reset: () => void;
}

export function useSignIn(): UseSignIn {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<SignInStep>("idle");
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setError(null);
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    if (!isSupportedChainId(chainId)) {
      setError("Switch to Base or Base Sepolia first.");
      return;
    }

    try {
      setStep("nonce");
      const { nonce } = await getNonce();

      const message = buildSiweMessage({
        address,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
      });

      setStep("awaiting-signature");
      const signature = await signMessageAsync({ message });

      setStep("verifying");
      await postVerify({ message, signature });

      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } catch (err) {
      setError(toFriendlyError(err));
    } finally {
      setStep("idle");
    }
  }, [address, chainId, signMessageAsync, queryClient]);

  return { signIn, step, error, reset: () => setError(null) };
}
