import type { Meta, StoryObj } from "@storybook/react-vite";
import { Check, Clock, ScanLine } from "lucide-react";
import { Button, Chip } from "../index";

const meta: Meta = { title: "Components/Actions" };
export default meta;

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon={<Check />} size={56}>
          Прийняти й додати у звіт
        </Button>
        <Button variant="outline" size={56}>
          Відкласти
        </Button>
        <Button variant="link">Деталі</Button>
        <Button variant="ghost">Чому</Button>
        <Button variant="icon" label="Прийняти" icon={<Check />} />
        <Button variant="icon" label="Відкласти" icon={<Clock />} />
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {([44, 48, 52, 56] as const).map((s) => (
          <Button key={s} size={s} variant="outline" icon={<ScanLine />}>
            Height {s}
          </Button>
        ))}
      </div>
      <div className="rounded-hero bg-ink p-6">
        <Button variant="signal" size={52}>
          Зберегти в план на 2026
        </Button>
      </div>
    </div>
  ),
};

export const Chips: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Chip tone="signal" icon={<Clock />}>
        Почніть з цього · до заморозків 6 днів
      </Chip>
      <Chip tone="urgent">Терміново</Chip>
      <Chip tone="week">Цього тижня</Chip>
      <Chip tone="ok">У порядку</Chip>
      <Chip tone="info">Заморозки з 20 листопада</Chip>
      <Chip tone="signal">План: культура на 2026 · до 15 лютого</Chip>
      <Chip tone="source">POWER · 2026-11-13 06:00</Chip>
    </div>
  ),
};
