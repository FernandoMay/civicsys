/**
 * The tally breakdown used to render "Opción 0" next to a ballot that offered
 * "A favor". The result was correct and unreadable, and nothing tested the link
 * between the two — they each carried their own copy of the names.
 */

import { describe, expect, it } from "vitest";

import { CHOICES, choiceLabel } from "./ballot.js";

describe("choiceLabel", () => {
  it("names each option the ballot offers", () => {
    expect(choiceLabel(0)).toBe("A favor");
    expect(choiceLabel(1)).toBe("En contra");
    expect(choiceLabel(2)).toBe("Abstención");
  });

  // The contract could gain an option. Showing a real vote under a name that
  // does not exist would be a lie; an unnamed index is honest.
  it("does not guess a label for a value this build does not know", () => {
    expect(choiceLabel(7)).toBe("Opción 7");
    expect(choiceLabel(-1)).toBe("Opción -1");
  });

  it("accepts the bigint form the tally map keys can arrive in", () => {
    expect(choiceLabel(0n)).toBe("A favor");
    expect(choiceLabel(3n)).toBe("Opción 3");
  });
});

describe("CHOICES", () => {
  // The on-chain index is the stored value. Reordering this list would relabel
  // every vote already stored, which is why the values are explicit.
  it("pins the on-chain index of every option", () => {
    expect(CHOICES.map((c) => c.value)).toEqual([0, 1, 2]);
  });

  it("gives every option a label and a description", () => {
    for (const c of CHOICES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.desc.length).toBeGreaterThan(0);
    }
  });
});