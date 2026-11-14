/**
 * PCG32 (O'Neill 2014, pcg32_random_r / XSH RR) with 64-bit state in BigInt: same seed → same sequence on every
 * platform (Tech Design §9.1 determinism).
 */
export class Pcg32 {
  private state = 0n;
  private readonly inc: bigint;
  private static readonly MULT = 6364136223846793005n;
  private static readonly MASK = (1n << 64n) - 1n;

  constructor(seed: bigint, stream = 54n) {
    this.inc = ((stream << 1n) | 1n) & Pcg32.MASK;
    this.next();
    this.state = (this.state + seed) & Pcg32.MASK;
    this.next();
  }

  /** Next 32-bit unsigned integer. */
  next(): number {
    const old = this.state;
    this.state = (old * Pcg32.MULT + this.inc) & Pcg32.MASK;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.next() / 2 ** 32;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** Standard normal (Box–Muller). */
  normal(): number {
    const u = Math.max(this.float(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.float());
  }
}

/** 64-bit seed from text (FNV-1a), e.g. hash(field id, inputs hash). */
export function seedFrom(text: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const ch of new TextEncoder().encode(text)) {
    h ^= BigInt(ch);
    h = (h * 0x100000001b3n) & ((1n << 64n) - 1n);
  }
  return h;
}
