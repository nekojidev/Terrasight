import { Global, Module } from "@nestjs/common";
import { BROKER } from "./broker.js";
import { MessagingMaintenance } from "./maintenance.service.js";
import { OutboxService } from "./outbox.service.js";
import { RabbitService } from "./rabbit.service.js";

@Global()
@Module({
  providers: [RabbitService, { provide: BROKER, useExisting: RabbitService }, OutboxService, MessagingMaintenance],
  exports: [BROKER, OutboxService],
})
export class MessagingModule {}
