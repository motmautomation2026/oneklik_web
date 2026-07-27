export interface CreditPack {
  id: string;
  credits: number;
  priceInr: number;
  comingSoon: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", credits: 4000, priceInr: 6000, comingSoon: false },
  { id: "growth", credits: 12000, priceInr: 17000, comingSoon: false },
  { id: "business", credits: 20000, priceInr: 28000, comingSoon: false },
];

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id && !p.comingSoon);
}
