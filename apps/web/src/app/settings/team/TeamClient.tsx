"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SelectField, Skeleton, TextField } from "@terrasight/ui";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";

type Role = "owner" | "agronomist";
interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  needsSetup: boolean;
}
interface Fresh {
  name: string;
  setupUrl: string;
  expiresAt: string;
}

/** Team page: list, add a user, change role, remove, copy-once setup links. */
export function TeamClient({ workspaceId, meId }: { workspaceId: string; meId: string }) {
  const t = useTranslations("App");
  const locale = useLocale();
  const client = useQueryClient();
  const key = ["members", workspaceId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ members: Member[] }>(`/api/w/${workspaceId}/members`),
  });
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; role: Role }>({
    name: "",
    email: "",
    role: "agronomist",
  });

  const assignable: Role[] = ["owner", "agronomist"];
  const options = (rs: Role[]) => rs.map((r) => ({ value: r, label: t(`role_${r}`) }));
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));

  const fail = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : "";
    setError(
      code === "already-member"
        ? t("teamErrAlready")
        : code === "owner-only"
          ? t("teamErrOwnerOnly")
          : code === "last-owner"
            ? t("teamErrLastOwner")
            : code === "rate-limited"
              ? t("errRateLimited")
              : code === "invalid-input"
                ? t("errInvalid")
                : t("errGeneric"),
    );
  };
  const show = (name: string, r: { setupUrl: string; expiresAt: string }) => {
    setFresh({ name, setupUrl: `${window.location.origin}${r.setupUrl}`, expiresAt: r.expiresAt });
    setCopied(false);
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ userId: string; setupUrl?: string; expiresAt?: string; existing?: true }>(
        `/api/w/${workspaceId}/members`,
        { body: form },
      );
      if (r.setupUrl && r.expiresAt) show(form.name, { setupUrl: r.setupUrl, expiresAt: r.expiresAt });
      else {
        setFresh(null);
        setNotice(t("teamExisting", { name: form.name }));
      }
      setForm({ ...form, name: "", email: "" });
      void client.invalidateQueries({ queryKey: key });
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  }

  async function newLink(m: Member) {
    setError(null);
    setNotice(null);
    try {
      show(
        m.name,
        await api<{ setupUrl: string; expiresAt: string }>(
          `/api/w/${workspaceId}/members/${m.id}/setup-link`,
          {
            method: "POST",
            body: {},
          },
        ),
      );
    } catch (err) {
      fail(err);
    }
  }

  async function changeRole(m: Member, next: Role) {
    setError(null);
    try {
      await api(`/api/w/${workspaceId}/members/${m.id}`, { method: "PATCH", body: { role: next } });
    } catch (err) {
      fail(err);
    }
    void client.invalidateQueries({ queryKey: key });
  }

  async function remove(m: Member) {
    if (!window.confirm(t("teamRemoveConfirm", { name: m.name }))) return;
    setError(null);
    try {
      await api(`/api/w/${workspaceId}/members/${m.id}`, { method: "DELETE" });
    } catch (err) {
      fail(err);
    }
    void client.invalidateQueries({ queryKey: key });
  }

  if (list.isError && !list.data) return <p className="text-body text-ink-2">{t("errGeneric")}</p>;
  if (!list.data) return <Skeleton label={t("loading")} className="h-64 w-full" />;
  const members = list.data.members;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-h1 text-ink">{t("teamTitle")}</h1>
        <p className="mt-1 max-w-[60ch] text-body text-ink-2">{t("teamSub")}</p>
      </header>
      {error && (
        <p role="alert" className="rounded-input bg-urgent-soft px-4 py-3 text-body text-urgent">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-input bg-surface-2 px-4 py-3 text-body text-ink">
          {notice}
        </p>
      )}
      {fresh && (
        <section
          aria-live="polite"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
        >
          <h2 className="text-h3 text-ink">{t("teamLinkTitle", { name: fresh.name })}</h2>
          <p className="text-small text-week">
            {t("teamLinkOnce", { name: fresh.name, date: date(fresh.expiresAt) })}
          </p>
          <code className="text-micro rounded-input bg-surface-2 p-3 break-all text-ink">
            {fresh.setupUrl}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Copy />}
              onClick={() => void navigator.clipboard.writeText(fresh.setupUrl).then(() => setCopied(true))}
            >
              {copied ? t("teamCopied") : t("teamCopyLink")}
            </Button>
            <Button variant="outline" onClick={() => setFresh(null)}>
              {t("teamDone")}
            </Button>
          </div>
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-labelledby="team-people" className="flex min-w-0 flex-col gap-3">
          <h2 id="team-people" className="text-h3 text-ink">
            {t("teamMembers", { n: members.length })}
          </h2>
          <ul className="flex flex-col gap-3">
            {members.map((m) => {
              const manageable = m.id !== meId;
              return (
                <li key={m.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-body font-semibold text-ink">
                        {m.name}
                        {m.id === meId && (
                          <span className="ml-2 text-small font-normal text-ink-3">{t("teamYou")}</span>
                        )}
                      </p>
                      <p className="truncate text-small text-ink-2">{m.email}</p>
                    </div>
                    {m.needsSetup && (
                      <span className="rounded-chip bg-surface-2 px-3 py-1 text-small font-semibold text-week">
                        {t("teamNeedsSetup")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {manageable ? (
                      <SelectField
                        label={t("teamChangeRole", { name: m.name })}
                        className="min-w-[180px] flex-1"
                        value={m.role}
                        onChange={(e) => void changeRole(m, e.target.value as Role)}
                        options={options(assignable)}
                      />
                    ) : (
                      <span className="text-small font-semibold text-ink-2">{t(`role_${m.role}`)}</span>
                    )}
                    {manageable && m.needsSetup && (
                      <Button variant="outline" icon={<Copy />} onClick={() => void newLink(m)}>
                        {t("teamNewLink")}
                      </Button>
                    )}
                    {manageable && (
                      <Button variant="ghost" icon={<Trash2 />} onClick={() => void remove(m)}>
                        {t("teamRemove")}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby="team-add" className="h-fit rounded-card border border-line bg-surface p-5">
          <h2 id="team-add" className="mb-4 text-h3 text-ink">
            {t("teamAddTitle")}
          </h2>
          <form onSubmit={(e) => void add(e)} className="flex flex-col gap-4">
            <TextField
              label={t("teamName")}
              name="name"
              autoComplete="off"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label={t("teamEmail")}
              name="email"
              type="email"
              autoComplete="off"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <SelectField
              label={t("teamRole")}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              options={options(assignable)}
            />
            <ul className="flex flex-col gap-2 text-small text-ink-2">
              {assignable.map((r) => (
                <li key={r}>{t(`teamRoleHelp_${r}`)}</li>
              ))}
            </ul>
            <Button
              type="submit"
              size={56}
              icon={<UserPlus />}
              className="w-full justify-center"
              disabled={busy}
              aria-busy={busy}
            >
              {t("teamAdd")}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
