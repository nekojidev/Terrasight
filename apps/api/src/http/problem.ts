import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { redactUrl } from "./redact.js";

/** RFC 9457 problem details, the error format of every endpoint (Tech Design §14). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Array<{ path: string; message: string }>;
}

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Not signed in",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict",
  410: "Gone",
  422: "Invalid input",
  429: "Too many requests",
  500: "Server error",
  503: "Unavailable",
};

export class ProblemException extends HttpException {
  constructor(status: number, code: string, detail?: string, errors?: Problem["errors"]) {
    super(
      {
        type: `https://terrasight.app/problems/${code}`,
        title: TITLES[status] ?? "Error",
        status,
        detail,
        errors,
      },
      status,
    );
  }
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("ProblemFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    let problem: Problem;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      problem =
        typeof body === "object" && body !== null && "type" in body
          ? (body as Problem)
          : {
              type: "about:blank",
              title: TITLES[status] ?? "Error",
              status,
              detail: typeof body === "string" ? body : ((body as { message?: string }).message ?? undefined),
            };
    } else if (exception instanceof z.ZodError) {
      problem = {
        type: "https://terrasight.app/problems/invalid-input",
        title: TITLES[422]!,
        status: 422,
        errors: exception.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    } else {
      this.log.error(`${req.method} ${redactUrl(req.originalUrl ?? req.url)}:${(exception as Error)?.stack ?? exception}`);
      problem = { type: "about:blank", title: TITLES[500]!, status: HttpStatus.INTERNAL_SERVER_ERROR };
    }
    if (typeof problem.detail === "object") delete problem.detail;
    res.status(problem.status).type("application/problem+json").json(problem);
  }
}
