import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Home, Map, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { BottomSheet, BottomTabs, Button, Sidebar, TopBar } from "../index";

const meta: Meta = { title: "Components/Navigation", parameters: { layout: "fullscreen" } };
export default meta;

const items = [
  { href: "#", label: "Головна", icon: <Home />, active: true, badge: 1 },
  { href: "#", label: "Поля", icon: <Map /> },
  { href: "#", label: "Сівозміни", icon: <RefreshCw /> },
  { href: "#", label: "Асистент", icon: <Sparkles /> },
  { href: "#", label: "Звіти", icon: <FileText /> },
];

export const Desktop: StoryObj = {
  render: () => (
    <div className="flex h-[640px]">
      <Sidebar
        label="Головне меню"
        brand={<b className="text-h2">Terrasight</b>}
        items={items}
        footer={<span className="text-small">Олена Коваль</span>}
      />
      <div className="flex-1">
        <TopBar
          crumb="Головна"
          searchLabel="Запитайте асистента або знайдіть поле"
          onSearch={() => {}}
          languageGroupLabel="Мова інтерфейсу"
          languages={[
            { code: "uk", label: "UA", active: true, onSelect: () => {} },
            { code: "en", label: "EN", active: false, onSelect: () => {} },
          ]}
          notificationsLabel="Сповіщення"
          hasNotifications
          onNotifications={() => {}}
        />
      </div>
    </div>
  ),
};

export const Phone: StoryObj = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <div className="relative h-[640px] w-[390px] border border-line">
      <BottomTabs label="Головне меню" items={[items[0]!, items[1]!, items[3]!, items[4]!]} />
    </div>
  ),
};

function SheetDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Відкрити</Button>
      <BottomSheet
        open={open}
        title="Власник побачить ось це"
        primaryLabel="Додати у звіт"
        cancelLabel="Скасувати"
        onPrimary={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <p className="text-body text-ink-2">Порахуйте попелиць на Півоті 14 до 20 листопада.</p>
      </BottomSheet>
    </div>
  );
}

export const Sheet: StoryObj = { render: () => <SheetDemo /> };
