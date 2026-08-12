// SPDX-License-Identifier: MIT
// Profile editor (PUT /profile) + avatar upload. Every field validates client-side to the SAME bounds
// the API/DB enforce (FUNCTIONAL_SPEC §3.1): display_name 1–50, headline ≤ 80, bio ≤ 500, ≤ 10 links,
// min price 1–10,000 USDC. Money is handled as base units via BigInt helpers — never a float on the
// money path (ADR-0021). The server remains authoritative (server-side authz + re-validation); the
// full async-state matrix is surfaced (validation / server / permission / network / success).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ME_QUERY_KEY } from "../../hooks/useMe";
import {
  ApiError,
  type CreatorProfile,
  NetworkError,
  type ProfilePatch,
  putProfile,
} from "../../lib/api";
import { formatUsdc, validatePrice } from "../../lib/usdc";
import formStyles from "../forms.module.css";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";
import { AvatarUploader } from "./AvatarUploader";
import { type LinkRow, LinksEditor, toLinkRows, validateLinks } from "./LinksEditor";

const MAX_HEADLINE = 80;
const MAX_BIO = 500;
const MAX_NAME = 50;

function mapProfileError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Your session expired — sign in again.";
    if (err.code === "no_profile") return "Claim a handle first.";
    if (err.code === "validation_error")
      return "Some fields are invalid — check the highlighted ones.";
    return err.message;
  }
  if (err instanceof NetworkError) return err.message;
  return "Couldn't save your profile. Please try again.";
}

export function ProfileEditor({ creator }: { creator: CreatorProfile }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(creator.displayName);
  const [headline, setHeadline] = useState(creator.headline ?? "");
  const [bio, setBio] = useState(creator.bio ?? "");
  const [price, setPrice] = useState(formatUsdc(creator.minPriceUsdc));
  const [links, setLinks] = useState<LinkRow[]>(() => toLinkRows(creator.links ?? []));
  const [submitted, setSubmitted] = useState(false);

  const nameError =
    displayName.trim().length === 0
      ? "Enter a display name."
      : displayName.trim().length > MAX_NAME
        ? `At most ${MAX_NAME} characters.`
        : undefined;
  const priceCheck = validatePrice(price);
  const priceError = priceCheck.ok ? undefined : priceCheck.reason;
  const linkCheck = validateLinks(links);

  const formValid = !nameError && !priceError && linkCheck.ok;

  const save = useMutation({
    mutationFn: () => {
      if (!priceCheck.ok || !linkCheck.ok || nameError) {
        throw new Error("Fix the highlighted fields.");
      }
      const patch: ProfilePatch = {
        displayName: displayName.trim(),
        headline: headline.trim() || null,
        bio: bio.trim() || null,
        links: linkCheck.links.length > 0 ? linkCheck.links : null,
        minPriceUsdc: priceCheck.base,
      };
      return putProfile(patch);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!formValid) return;
    save.mutate();
  }

  const showErr = submitted;
  const serverError = save.isError ? mapProfileError(save.error) : null;

  return (
    <Card>
      <form className={formStyles.form} onSubmit={onSubmit} noValidate>
        <section className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Photo</h2>
          <AvatarUploader avatarUrl={creator.avatarUrl} name={creator.displayName} />
        </section>

        <hr className={formStyles.divider} />

        <section className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Profile</h2>
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={MAX_NAME}
            error={showErr ? nameError : undefined}
            placeholder="Your name"
          />
          <Input
            label="Headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={MAX_HEADLINE}
            placeholder="What you can help with"
            hint="A one-liner shown under your name (optional)."
          />
          <Textarea
            label="Bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={MAX_BIO}
            showCount
            placeholder="Tell people what you answer, and why they should ask you."
          />
        </section>

        <hr className={formStyles.divider} />

        <section className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Price</h2>
          <Input
            label="Minimum price (USDC)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="5"
            error={showErr ? priceError : undefined}
            hint="What a question costs, at minimum. Askers can tip more. 1–10,000 USDC."
          />
        </section>

        <hr className={formStyles.divider} />

        <section className={formStyles.section}>
          <h2 className={formStyles.sectionTitle}>Links</h2>
          <LinksEditor links={links} onChange={setLinks} showErrors={showErr} />
        </section>

        {serverError ? (
          <p className="form-error" role="alert">
            {serverError}
          </p>
        ) : null}

        <div className={formStyles.actions}>
          <Button type="submit" isLoading={save.isPending} disabled={showErr && !formValid}>
            Save profile
          </Button>
          {save.isSuccess && !save.isPending ? (
            <span
              className={formStyles.grow}
              style={{ color: "var(--success)", alignSelf: "center" }}
            >
              Saved ✓
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
