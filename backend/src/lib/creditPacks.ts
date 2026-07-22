export interface CreditPack {
  id: string;
  credits: number;
  priceInr: number;
  comingSoon: boolean;
}

// Only "starter" is real right now — the other two are placeholders shown
// in the UI as "Coming soon" until pricing is decided for them.
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", credits: 4000, priceInr: 6000, comingSoon: false },
  { id: "growth", credits: 0, priceInr: 0, comingSoon: true },
  { id: "scale", credits: 0, priceInr: 0, comingSoon: true },
];

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id && !p.comingSoon);
}
