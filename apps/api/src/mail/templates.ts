export type Lang = "en" | "uk";

interface Copy {
  subject: string;
  text: string;
}

/** Email copy (EN + UK). `link` is the only variable part; templates never include tokens elsewhere. */
export const templates = {
  verify(lang: Lang, name: string, link: string): Copy {
    return lang === "uk"
      ? {
          subject: "Підтвердіть електронну пошту в Terrasight",
          text: `Вітаємо, ${name}!\n\nЩоб підтвердити адресу, відкрийте посилання (діє 24 години):\n${link}\n\nЯкщо ви не реєструвалися в Terrasight, просто проігноруйте цей лист.`,
        }
      : {
          subject: "Verify your email for Terrasight",
          text: `Hello ${name},\n\nOpen this link to verify your email address (valid for 24 hours):\n${link}\n\nIf you didn't sign up for Terrasight, you can ignore this email.`,
        };
  },
  alreadyRegistered(lang: Lang, link: string): Copy {
    return lang === "uk"
      ? {
          subject: "У вас уже є акаунт у Terrasight",
          text: `Хтось (імовірно, ви) спробував зареєструватися з цією адресою, але акаунт уже існує.\n\nУвійти: ${link}\n\nЯкщо ви забули пароль, скористайтеся посиланням «Забули пароль?» на сторінці входу. Якщо це були не ви, нічого робити не потрібно.`,
        }
      : {
          subject: "You already have a Terrasight account",
          text: `Someone (probably you) tried to sign up with this address, but an account already exists.\n\nSign in: ${link}\n\nIf you forgot your password, use "Forgot password?" on the sign-in page. If this wasn't you, no action is needed.`,
        };
  },
  reset(lang: Lang, link: string): Copy {
    return lang === "uk"
      ? {
          subject: "Відновлення пароля Terrasight",
          text: `Щоб задати новий пароль, відкрийте посилання (діє 1 годину, одноразове):\n${link}\n\nЯкщо ви не просили відновлення, проігноруйте цей лист: ваш пароль не змінився.`,
        }
      : {
          subject: "Reset your Terrasight password",
          text: `Open this link to choose a new password (valid for 1 hour, single use):\n${link}\n\nIf you didn't ask for this, ignore this email: your password hasn't changed.`,
        };
  },
  invitation(lang: Lang, workspace: string, link: string): Copy {
    return lang === "uk"
      ? {
          subject: `Запрошення до «${workspace}» у Terrasight`,
          text: `Вас запросили до компанії «${workspace}».\n\nПрийняти запрошення (діє 7 днів; потрібна підтверджена пошта):\n${link}`,
        }
      : {
          subject: `You're invited to ${workspace} on Terrasight`,
          text: `You've been invited to join ${workspace}.\n\nAccept the invitation (valid for 7 days; a verified email is required):\n${link}`,
        };
  },
};
