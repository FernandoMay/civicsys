import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProposalContent from "./ProposalContent.js";
import type { ProposalView } from "../lib/chain.js";

vi.mock("@brugulacivica/sdk", () => ({
  sha256Utf8: vi.fn(async () => "f".repeat(64)),
}));

const proposal: ProposalView = {
  id: 1n,
  proposer: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  title_hash: "a".repeat(64),
  description_hash: "b".repeat(64),
  metadata_hash: "c".repeat(64),
  content_cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  evidence_root: "d".repeat(64),
  created_at: 1_700_000_000n,
  opens_at: 1_700_000_000n,
  closes_at: 1_700_003_600n,
  cancelled: false,
  cancel_reason_hash: null,
  evidence: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("ProposalContent — off-chain integrity", () => {
  it("fails closed when the CID format is not recognized", async () => {
    render(<ProposalContent proposal={{ ...proposal, content_cid: "not-a-cid" }} />);
    expect(await screen.findByText("[UNKNOWN] Contenido no verificable")).toBeInTheDocument();
    expect(screen.getByText(/formato reconocible/)).toBeInTheDocument();
  });

  it("does not render retrieved content as verified when hashes differ", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        schema: "brujula-civica/proposal-content@1",
        title: "Contenido manipulado",
        description: "Texto no comprometido",
        metadata: "{}",
        created_at: "2026-10-11T00:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProposalContent proposal={proposal} />);
    expect(await screen.findByText("[MISMATCH] Integridad no demostrada")).toBeInTheDocument();
    expect(screen.queryByText("Contenido manipulado")).toBeNull();
  });
});
