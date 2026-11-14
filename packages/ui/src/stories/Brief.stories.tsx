import type { Meta, StoryObj } from "@storybook/react-vite";
import { Clock } from "lucide-react";
import { useState } from "react";
import {
  AnalysisPanel,
  Chip,
  DoneRow,
  FieldThumb,
  HeroItem,
  QueueRow,
  RailCard,
  SeasonStrip,
} from "../index";

const meta: Meta = { title: "Components/Brief" };
export default meta;

const strip = (
  <SeasonStrip
    size="sm"
    seasons={["winter_wheat", "sorghum", "fallow", "winter_wheat", "winter_wheat"].map((crop, i) => ({
      crop,
      name: crop,
      year: 2022 + i,
    }))}
  />
);

function HeroDemo() {
  const [undoUntil, setUndoUntil] = useState<number | null>(null);
  return (
    <HeroItem
      className="max-w-3xl"
      chip={
        <Chip tone="signal" icon={<Clock />}>
          Почніть з цього · до заморозків 6 днів
        </Chip>
      }
      field={
        <span className="flex items-center gap-3">
          <FieldThumb name="Півот 14" crop="winter_wheat" size={40} />
          <span className="text-small">
            <b className="block text-ink">Півот 14</b>
            <span className="text-ink-2">Канзас · округ Фінні</span>
          </span>
          {strip}
        </span>
      }
      title="Порахуйте попелиць на Півоті 14 до заморозків"
      numbers={[
        { value: "топ 10%", label: "найтепліша осінь з 1981", weight: 0.9 },
        { value: "41", label: "день від сходів", weight: 0.6 },
        { value: "6", label: "днів до заморозків", weight: 0.4 },
      ]}
      confidence="Середня впевненість · огляньте поле, щоб підтвердити"
      labels={{ accept: "Прийняти й додати у звіт", snooze: "Відкласти", details: "Деталі" }}
      detailsHref="#"
      onAccept={() => setUndoUntil(Date.now() + 8_000)}
      onSnooze={() => setUndoUntil(Date.now() + 8_000)}
      done={
        undoUntil
          ? {
              label: "Півот 14 · додано у звіт власнику",
              undoLabel: "Скасувати",
              undoUntil,
              onUndo: () => setUndoUntil(null),
            }
          : undefined
      }
    />
  );
}

export const Hero: StoryObj = { render: () => <HeroDemo /> };

export const Queue: StoryObj = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-3">
      <QueueRow
        thumb={<FieldThumb name="Сухе поле 5" shape="strip" crop="winter_wheat" />}
        title="Огляньте пшеницю на смугасту мозаїку"
        meta="Сухе поле 5 · Колорадо · округ Логан"
        due="цього тижня"
        strip={strip}
        factors={[
          {
            label: "Зелена падалиця до сівби",
            value: "18 днів",
            weight: 0.8,
            source: "Sentinel-2 · 2026-10-02",
          },
          { label: "Тепла осінь", weight: 0.6, source: "POWER · 2026-11-13" },
        ]}
        labels={{ why: "Чому", accept: "Прийняти", snooze: "Відкласти" }}
        onAccept={() => {}}
        onSnooze={() => {}}
      />
      <QueueRow
        thumb={null}
        title="done"
        meta=""
        due=""
        factors={[]}
        labels={{ why: "Чому", accept: "Прийняти", snooze: "Відкласти" }}
        onAccept={() => {}}
        onSnooze={() => {}}
        done={{
          label: "Відкладено до завтра 06:00",
          undoLabel: "Скасувати",
          undoUntil: Date.now() + 8_000,
          onUndo: () => {},
        }}
      />
    </div>
  ),
};

export const Done: StoryObj = {
  render: () => (
    <DoneRow
      className="max-w-sm"
      label="Смуга «Північ» · додано у звіт власнику"
      undoLabel="Скасувати"
      undoUntil={Date.now() + 8_000}
      onUndo={() => {}}
    />
  ),
};

export const Rail: StoryObj = {
  render: () => (
    <RailCard title="Власник питає" className="max-w-sm">
      <p className="text-body text-ink">«А скільки ми втратимо, якщо не сіяти кукурудзу?»</p>
    </RailCard>
  ),
};

export const Analysis: StoryObj = {
  render: () => (
    <AnalysisPanel
      className="max-w-xl"
      title="Аналіз полів"
      fields={[
        { id: "1", name: "Півот 12", status: "done" },
        { id: "2", name: "Півот 14", status: "running" },
        {
          id: "3",
          name: "Півот 21",
          status: "no_data",
          note: "NASA POWER не відповів — показуємо вчорашні дані",
        },
        { id: "4", name: "Сухе поле 5", status: "waiting" },
      ]}
      statusLabels={{ waiting: "у черзі", running: "перевіряємо", done: "готово", no_data: "Немає даних" }}
      seasonTitle="Що перевіряємо в листопаді"
      seasonChecks={[
        "Сівозміна на наступний рік",
        "Попелиці й заморозки на озимих",
        "Зимова ерозія на голих полях",
      ]}
      retryLabel="Повторити"
      onRetry={() => {}}
    />
  ),
};
