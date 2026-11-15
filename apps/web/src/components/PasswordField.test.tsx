import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import built from "../../messages/en.json";
import { PasswordField } from "./PasswordField";

afterEach(cleanup);

const mount = (error?: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={built}>
      <PasswordField label="Password" name="password" rules error={error} />
    </NextIntlClientProvider>,
  );

describe("PasswordField", () => {
  it("shows the rules before typing and toggles visibility with a labelled button", () => {
    mount();
    expect(screen.getByText("At least 10 characters.")).toBeTruthy();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("type")).toBe("button");
  });

  it("shows an error as an alert next to the field", () => {
    mount("Too short");
    expect(screen.getByRole("alert").textContent).toBe("Too short");
  });
});
