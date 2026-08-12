// SPDX-License-Identifier: MIT
// Header wallet chip: the connected chain + truncated address + disconnect, or a muted "Not
// connected". Purely informational — connecting/signing-in happens in the main panel.

import { useAccount, useDisconnect } from "wagmi";
import { chainName, isSupportedChainId } from "../lib/chains";
import { truncateAddress } from "../lib/format";
import styles from "./WalletStatus.module.css";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

export function WalletStatus() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();

  if (!isConnected || !address) {
    return <span className={styles.disconnected}>Not connected</span>;
  }

  return (
    <div className={styles.wallet}>
      <Badge tone={isSupportedChainId(chainId) ? "accent" : "danger"}>{chainName(chainId)}</Badge>
      <span className="address">{truncateAddress(address)}</span>
      <Button variant="ghost" size="sm" onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  );
}
