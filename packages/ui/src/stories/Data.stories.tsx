import type { Meta, StoryObj } from "@storybook/react-vite";
import { BigNumber, FactorRows, FieldThumb, SeasonStrip } from "../index";

const meta: Meta = { title: "Components/Data" };
export default meta;

const seasons = [
  { crop: "corn", name: "Кукурудза", year: 2022 },
  { crop: "corn", name: "Кукурудза", year: 2023 },
  { crop: "winter_wheat", name: "Пшениця озима", year: 2024 },
  { crop: "sorghum", name: "Сорго", year: 2025 },
  { crop: "alfalfa", name: "Люцерна", year: 2026 },
];

export const BigNumbers: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl grid-cols-3 gap-6">
      <BigNumber value="3/5" label="сезонів кукурудза після кукурудзи" weight={0.8} />
      <BigNumber value="2" label="роки кукурудзи поспіль" weight={0.6} />
      <BigNumber value="+$123" label="на га на рік з люцерною" weight={0.4} />
    </div>
  ),
};

export const Factors: StoryObj = {
  render: () => (
    <FactorRows
      className="max-w-xl"
      factors={[
        { label: "Тепла осінь", value: "топ 10% з 1981", weight: 0.9, source: "POWER · 2026-11-13" },
        { label: "Днів від сходів", value: "41", weight: 0.6, source: "NDVI · 2026-11-09" },
        { label: "До заморозків", value: "6 днів", weight: 0.4, source: "Open-Meteo · 2026-11-14" },
      ]}
    />
  ),
};

export const Strips: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SeasonStrip seasons={seasons} />
      <SeasonStrip seasons={seasons} label="2022–26" />
      <SeasonStrip seasons={seasons} size="sm" />
    </div>
  ),
};

export const Thumbs: StoryObj = {
  render: () => (
    <div className="flex gap-3">
      <FieldThumb name="Півот 12" crop="corn" />
      <FieldThumb name="Півот 14" crop="winter_wheat" size={64} />
      <FieldThumb name="Смуга «Північ»" shape="strip" crop="fallow" />
    </div>
  ),
};
