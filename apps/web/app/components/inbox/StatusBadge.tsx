// SPDX-License-Identifier: MIT
// A Badge that renders a question's lifecycle status with the matching tone — used identically by the
// inbox rows, the history list, and the detail header so a status always looks the same.

import type { QuestionStatus } from "@buyananswer/shared";
import { statusLabel, statusTone } from "../../lib/status";
import { Badge } from "../ui/Badge";

export function StatusBadge({ status }: { status: QuestionStatus }) {
  return <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>;
}
