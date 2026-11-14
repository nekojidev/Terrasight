import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

const preview: Preview = {
  parameters: { layout: "padded", backgrounds: { disable: true } },
  globalTypes: {
    theme: {
      description: "Theme (dark is design only, P2)",
      toolbar: { items: ["light", "dark"], dynamicTitle: true },
    },
  },
  decorators: [
    (Story, ctx) => {
      document.documentElement.dataset.theme = ctx.globals.theme === "dark" ? "dark" : "light";
      return Story();
    },
  ],
};
export default preview;
