/**
 * The ballot, in one place.
 *
 * `choice` is the raw on-chain index the contract stores. It is never remapped,
 * so a value stored by one build is read back identically by the next. But the
 * index is not what a person should read: a tally breakdown that renders
 * "Opción 0" instead of "A favor" makes a correct result unreadable, and the
 * ballot and the tally used to drift apart because each carried its own copy
 * of these names.
 *
 * Both the ballot and every tally breakdown now read from here, so they cannot
 * disagree about what a stored number means.
 */

export type BallotChoice = { value: number; label: string; desc: string };

/** Ballot options. Index is the on-chain `choice` value; never remapped. */
export const CHOICES: BallotChoice[] = [
  { value: 0, label: "A favor", desc: "Apoyo la iniciativa tal como está registrada." },
  { value: 1, label: "En contra", desc: "Rechazo la iniciativa tal como está registrada." },
  { value: 2, label: "Abstención", desc: "Cuenta para el quórum sin inclinar la decisión." },
];

/**
 * Names a stored `choice` value.
 *
 * An index this build does not know about is reported as `Opción N`, never
 * guessed into one of the three labels: the contract could grow an option, and
 * showing a real vote under a wrong name is worse than showing an unnamed one.
 */
export function choiceLabel(choice: number | bigint): string {
  const n = typeof choice === "bigint" ? Number(choice) : choice;
  return CHOICES.find((c) => c.value === n)?.label ?? `Opción ${n}`;
}