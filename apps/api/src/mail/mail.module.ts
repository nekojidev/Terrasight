import { Controller, Get, Global, Inject, Module, NotFoundException, Query } from "@nestjs/common";
import { ENV, type Env } from "../config/config.js";
import { linkIn, Mailer } from "./mailer.js";

/**
 * Test hook (AUTH_TEST_HOOKS=1, never in production): returns the link of the latest outbox email for an
 * address, so the Postman contract and Cypress runs can complete email verification like a real user.
 */
@Controller("test")
class TestHooksController {
  constructor(
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get("outbox")
  outbox(@Query("to") to: string | undefined) {
    if (this.env.AUTH_TEST_HOOKS !== "1" || this.env.NODE_ENV === "production" || this.env.SMTP_URL)
      throw new NotFoundException();
    const mail = to ? this.mailer.latestFor(to) : null;
    if (!mail) throw new NotFoundException();
    return { subject: mail.subject, link: linkIn(mail.text) };
  }
}

@Global()
@Module({ controllers: [TestHooksController], providers: [Mailer], exports: [Mailer] })
export class MailModule {}
