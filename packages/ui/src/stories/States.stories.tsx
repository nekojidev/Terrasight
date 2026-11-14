import type { Meta, StoryObj } from "@storybook/react-vite";
import { DoneRow, EmptyState, ErrorCard, Skeleton } from "../index";

const meta: Meta = { title: "Components/States" };
export default meta;

/** The States board (design 17): loading, source error, success with 8 s Undo, empty. */
export const Board: StoryObj = {
  render: () => (
    <div className="grid max-w-5xl grid-cols-4 gap-4">
      <Skeleton label="Завантаження" />
      <ErrorCard
        title="Півот 21: NASA POWER не відповів"
        body="Показуємо вчорашні дані від 13 листопада, 06:00."
        stamp="POWER · 2026-11-13 06:00"
        retryLabel="Повторити"
        onRetry={() => {}}
      />
      <DoneRow
        label="Смуга «Північ» · додано у звіт власнику"
        undoLabel="Скасувати"
        undoUntil={Date.now() + 8_000}
        onUndo={() => {}}
      />
      <EmptyState
        text="Перший запуск — окремий екран «Головна до першого поля»."
        actionLabel="Відкрити"
        onAction={() => {}}
      />
    </div>
  ),
};
