import {
  CivicReader,
  parseDeployment,
  type ProposalView,
  type Read,
} from "@civicsys/sdk";
import deploymentRaw from "../../../../deployments/testnet.json";

const record = parseDeployment(deploymentRaw);

export const reader = new CivicReader(record);

export type ProposalRow = {
  id: bigint;
  proposal: Read<ProposalView | null>;
  status: Read<number>;
};

export async function fetchProposalRows(maxCount = 20): Promise<{
  nextId: Read<bigint>;
  rows: ProposalRow[];
  loadedCount: number;
}> {
  const nextId = await reader.nextProposalId();

  if (nextId.status !== "ok") {
    return { nextId, rows: [], loadedCount: 0 };
  }

  const next = nextId.value;
  const upper = Number(next) > maxCount ? maxCount : Number(next);
  const rows: ProposalRow[] = [];

  for (let i = 1; i <= upper; i++) {
    const id = BigInt(i);
    const proposal = await reader.getProposal(id);
    const status = await reader.proposalStatus(id);
    rows.push({ id, proposal, status });
  }

  return { nextId, rows, loadedCount: rows.length };
}
