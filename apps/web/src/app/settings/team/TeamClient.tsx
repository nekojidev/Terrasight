"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, SelectField, Surface, TextField, useToast } from "@terrasight/ui";
import { CheckCircle2, Clock, Copy, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { QueryState } from "@/components/QueryState";
import { api, ApiError } from "@/lib/api";
import { authErrorKind, isEmail } from "@/lib/auth-errors";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

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

const ASSIGNABLE: Role[] = ["owner", "agronomist"];

/** Team page (Owner only): people with role and status, add a person, one-time setup links, danger zone to remove. */
export function TeamClient({ workspaceId, meId }: { workspaceId: string; meId: string }) {
  const t = useTranslations("App");
  const s = useTranslations("Settings");
  const l = useTranslations("Login");
  const f = useFormat();
  const toast = useToast();
  const action = useActionToast();
  const client = useQueryClient();
  const key = ["members", workspaceId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ members: Member[] }>(`/api/w/${workspaceId}/members`),
  });
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [form, setForm] = useState<{ name: string; email: string; role: Role }>({
    name: "",
    email: "",
    role: "agronomist",
  });
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});

  const roleOptions = ASSIGNABLE.map((r) => ({ value: r, label: t(`role_${r}`) }));

  /** Known server refusals read as plain sentences; anything else goes through the shared failure toast. */
  const fail = (e: unknown, what: string, retry?: () => void) => {
    const code = e instanceof ApiError ? e.code : "";
    if (code === "owner-only") toast.show(t("teamErrOwnerOnly"), "error");
    else if (code === "last-owner") toast.show(t("teamErrLastOwner"), "error");
    else action.fail(e, what, retry);
  };
  const show = (name: string, r: { setupUrl: string; expiresAt: string }) => {
    setFresh({ name, setupUrl: `${window.location.origin}${r.setupUrl}`, expiresAt: r.expiresAt });
    setCopied(false);
  };

  async function add(e: FormEvent) {
    e.preventDefault();
    const found: typeof errors = {};
    if (!form.name.trim()) found.name = l("errNameEmpty");
    if (!isEmail(form.email)) found.email = l("errEmailFormat");
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api<{ userId: string; setupUrl: string; expiresAt: string }>(
        `/api/w/${workspaceId}/members`,
        { body: { ...form, name: form.name.trim(), email: form.email.trim() } },
      );
      show(form.name.trim(), r);
      setForm({ ...form, name: "", email: "" });
      setAdding(false);
      void client.invalidateQueries({ queryKey: key });
    } catch (err) {
      if (authErrorKind(err) === "taken") setErrors({ email: t("teamErrEmailInUse") });
      else fail(err, s("teamFail"));
    }
    setBusy(false);
  }

  async function newLink(m: Member) {
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
      fail(err, s("teamFail"), () => void newLink(m));
    }
  }

  async function changeRole(m: Member, next: Role) {
    try {
      await api(`/api/w/${workspaceId}/members/${m.id}`, { method: "PATCH", body: { role: next } });
    } catch (err) {
      fail(err, s("teamFail"), () => void changeRole(m, next));
    }
    void client.invalidateQueries({ queryKey: key });
  }

  async function remove(m: Member) {
    setRemoving(null);
    try {
      await api(`/api/w/${workspaceId}/members/${m.id}`, { method: "DELETE" });
      toast.show(s("removedToast", { name: m.name }), "info");
    } catch (err) {
      fail(err, s("teamFail"), () => void remove(m));
    }
    void client.invalidateQueries({ queryKey: key });
  }

  const copy = (url: string) =>
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        toast.show(s("linkCopied"), "info");
      },
      (err) => action.fail(err, t("teamCopyLink")),
    );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-h2 text-ink">{t("teamTitle")}</h2>
        <p className="mt-1 max-w-[60ch] text-body text-ink-2">{t("teamSub")}</p>
      </header>

      {fresh && (
        <Surface as="section" aria-live="polite" className="flex flex-col gap-3">
          <h2 className="text-h3 text-ink">{t("teamLinkTitle", { name: fresh.name })}</h2>
          <p className="text-small text-ink-2">
            {s("linkOnce", { name: fresh.name, date: f.date(fresh.expiresAt, "full") })}
          </p>
          <input
            readOnly
            value={fresh.setupUrl}
            aria-label={t("teamCopyLink")}
            onFocus={(e) => e.currentTarget.select()}
            className="focus-ring min-h-13 w-full rounded-input border border-line-control bg-surface-2 px-4 font-mono text-caption text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<Copy />} onClick={() => copy(fresh.setupUrl)}>
              {copied ? t("teamCopied") : t("teamCopyLink")}
            </Button>
            <Button variant="link" className="px-3" onClick={() => setFresh(null)}>
              {t("teamDone")}
            </Button>
          </div>
        </Surface>
      )}

      <Surface as="section" aria-labelledby="team-people" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="team-people" className="text-h3 text-ink">
            {list.data ? t("teamMembers", { n: list.data.members.length }) : t("teamTitle")}
          </h2>
          {!adding && (
            <Button icon={<UserPlus />} onClick={() => setAdding(true)}>
              {s("addPerson")}
            </Button>
          )}
        </div>

        {adding && (
          <form
            onSubmit={(e) => void add(e)}
            noValidate
            className="flex flex-col gap-4 rounded-card border border-line bg-surface-2 p-4"
          >
            <div>
              <h3 className="text-body font-semibold text-ink">{s("addPersonTitle")}</h3>
              <p className="text-small text-ink-2">{s("addPersonSub")}</p>
            </div>
            <TextField
              label={t("teamName")}
              name="name"
              autoComplete="off"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
            />
            <TextField
              label={t("teamEmail")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="off"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={errors.email}
            />
            <SelectField
              label={t("teamRole")}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              options={roleOptions}
            />
            <ul className="flex flex-col gap-2 text-small text-ink-2">
              {ASSIGNABLE.map((r) => (
                <li key={r}>{t(`teamRoleHelp_${r}`)}</li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size={48} disabled={busy} aria-busy={busy}>
                {s("createPerson")}
              </Button>
              <Button
                variant="link"
                className="px-3"
                onClick={() => {
                  setAdding(false);
                  setErrors({});
                }}
              >
                {s("cancel")}
              </Button>
            </div>
          </form>
        )}

        <QueryState query={list} skeletonVariant="rows" what={s("teamLoadWhat")}>
          {({ members }) => (
            <ul className="flex flex-col divide-y divide-line">
              {members.map((m) => {
                const manageable = m.id !== meId;
                return (
                  <li key={m.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-ink">
                          {m.name}
                          {!manageable && (
                            <span className="ml-2 text-small font-normal text-ink-2">{t("teamYou")}</span>
                          )}
                        </p>
                        <p className="truncate text-small text-ink-2">{m.email}</p>
                      </div>
                      <p
                        className={`inline-flex items-center gap-2 text-small font-semibold ${m.needsSetup ? "text-week" : "text-ok"}`}
                      >
                        {m.needsSetup ? (
                          <Clock aria-hidden className="size-4" />
                        ) : (
                          <CheckCircle2 aria-hidden className="size-4" />
                        )}
                        {m.needsSetup ? s("statusPending") : s("statusActive")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {manageable ? (
                        <SelectField
                          label={t("teamChangeRole", { name: m.name })}
                          className="min-w-[180px] flex-1"
                          value={m.role}
                          onChange={(e) => void changeRole(m, e.target.value as Role)}
                          options={roleOptions}
                        />
                      ) : (
                        <p className="text-small font-semibold text-ink-2">{t(`role_${m.role}`)}</p>
                      )}
                      {manageable && m.needsSetup && (
                        <Button
                          variant="outline"
                          icon={<Copy />}
                          aria-label={s("newLinkFor", { name: m.name })}
                          onClick={() => void newLink(m)}
                        >
                          {s("newLink")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Surface>

      {list.data && list.data.members.some((m) => m.id !== meId) && (
        <Surface as="section" aria-labelledby="team-danger" className="border-urgent">
          <h2 id="team-danger" className="mb-1 text-h3 text-urgent">
            {s("dangerTitle")}
          </h2>
          <p className="mb-4 text-small text-ink-2">{s("dangerTeamSub")}</p>
          <ul className="flex flex-col gap-2">
            {list.data.members
              .filter((m) => m.id !== meId)
              .map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-ink">{m.name}</span>
                  <Button
                    variant="outline"
                    icon={<Trash2 />}
                    aria-label={s("removeFor", { name: m.name })}
                    onClick={() => setRemoving(m)}
                  >
                    {t("teamRemove")}
                  </Button>
                </li>
              ))}
          </ul>
        </Surface>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t("teamRemoveTitle", { name: removing?.name ?? "" })}
        confirmLabel={t("teamRemove")}
        cancelLabel={t("cancel")}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      >
        {t("teamRemoveBody")}
      </ConfirmDialog>
    </div>
  );
}
