import { Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { ProblemException } from "./problem.js";

/** Validates a request part with a zod schema; failures become 422 problem details. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ProblemException(
        422,
        "invalid-input",
        undefined,
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    return parsed.data;
  }
}
