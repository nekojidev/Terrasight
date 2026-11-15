"use client";

import { Button, TextField, type TextFieldProps } from "@terrasight/ui";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export const PASSWORD_MIN = 10;

/** Password input with a 44 px show/hide toggle. `rules` shows the minimum length before the person types. */
export function PasswordField({
  rules,
  hint,
  ...rest
}: Omit<TextFieldProps, "type" | "trailing"> & { rules?: boolean }) {
  const t = useTranslations("Login");
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...rest}
      type={shown ? "text" : "password"}
      hint={hint ?? (rules ? t("passRules", { n: PASSWORD_MIN }) : undefined)}
      trailing={
        <Button
          variant="icon"
          label={shown ? t("hide") : t("show")}
          aria-pressed={shown}
          className="border-transparent"
          icon={shown ? <EyeOff /> : <Eye />}
          onClick={() => setShown((v) => !v)}
        />
      }
    />
  );
}
