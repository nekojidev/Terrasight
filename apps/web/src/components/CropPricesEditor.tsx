"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, SelectField, Skeleton } from "@terrasight/ui";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { useReportError } from "@/components/useReportError";

type Currency = "USD" | "UAH";
interface PricesView {
  currency: Currency;
  canChangeCurrency: boolean;
  crops: Array<{ id: string; en: string; uk: string }>;
  rows: Array<{
    crop: string;
    pricePerT: number;
    variableCostPerHa: number;
    yieldRefTHa: number | null;
    irrigated: boolean | null;
    usable: boolean;
  }>;
}
type Draft = Record<string, { price: string; cost: string; yield: string }>;

const num = (v: string) => Number(v.trim().replace(",", "."));
const filled = (v: string) => v.trim() !== "";
const input =
  "focus-ring block w-full min-h-11 rounded-input border border-line-strong bg-surface px-3 text-body text-ink placeholder:text-ink-3 aria-[invalid=true]:border-urgent";

/**
 * The company's own crop prices (user data): price per t, costs per ha and an optional expected yield for each crop,
 * in the workspace currency. Used on the rotation page (crops of the compared rotations) and in Settings (any crop).
 */
export function CropPricesEditor({
  workspaceId,
  crops = [],
  allowAdd = false,
  yieldHints = {},
  needYield = [],
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  /** Crops to list even when they have no saved row yet. */
  crops?: string[];
  allowAdd?: boolean;
  /** Oblast average yields for context only (never filled in for the user). */
  yieldHints?: Record<string, { meanTHa: number; oblast: string }>;
  /** Crops that have a price but still need the user's yield. */
  needYield?: string[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const q = useQuery({
    queryKey: ["crop-prices", workspaceId],
    queryFn: () => api<PricesView>(`/api/w/${workspaceId}/crop-prices`),
  });
  const t = useTranslations("App");
  if (q.isPending) return <Skeleton label={t("rotLoading")} />;
  if (q.isError || !q.data) return <p className="text-body text-urgent">{t("errGeneric")}</p>;
  return (
    <Table
      key={q.data.currency}
      workspaceId={workspaceId}
      data={q.data}
      crops={crops}
      allowAdd={allowAdd}
      yieldHints={yieldHints}
      needYield={needYield}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

function Table({
  workspaceId,
  data,
  crops,
  allowAdd,
  yieldHints,
  needYield,
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  data: PricesView;
  crops: string[];
  allowAdd: boolean;
  yieldHints: Record<string, { meanTHa: number; oblast: string }>;
  needYield: string[];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("App");
  const locale = useLocale() as "en" | "uk";
  const qc = useQueryClient();
  const report = useReportError();
  const usable = data.rows.filter((r) => r.usable);
  const name = (id: string) => data.crops.find((c) => c.id === id)?.[locale] ?? id.replace(/_/g, " ");
  const [list, setList] = useState<string[]>(() => [...new Set([...crops, ...usable.map((r) => r.crop)])]);
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      usable.map((r) => [
        r.crop,
        {
          price: String(r.pricePerT),
          cost: String(r.variableCostPerHa),
          yield: r.yieldRefTHa != null ? String(r.yieldRefTHa) : "",
        },
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const cell = (c: string) => draft[c] ?? { price: "", cost: "", yield: "" };
  const set = (c: string, k: "price" | "cost" | "yield", v: string) => {
    setSaved(false);
    setDraft({ ...draft, [c]: { ...cell(c), [k]: v } });
  };
  const hadRow = new Set(usable.map((r) => r.crop));

  const currency = useMutation({
    mutationFn: (value: Currency) =>
      api(`/api/w/${workspaceId}`, { method: "PATCH", body: { currency: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop-prices", workspaceId] }),
    onError: report,
  });
  const save = useMutation({
    mutationFn: (body: { rows: unknown[]; remove: string[] }) =>
      api(`/api/w/${workspaceId}/crop-prices`, { method: "PUT", body }),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ["crop-prices", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["scenarios", workspaceId] });
      onSaved?.();
    },
    onError: report,
  });

  const submit = () => {
    const errs: Record<string, string> = {};
    const rows: unknown[] = [];
    const remove: string[] = [];
    for (const c of list) {
      const d = cell(c);
      const any = filled(d.price) || filled(d.cost);
      if (!any) {
        if (hadRow.has(c)) remove.push(c);
        continue;
      }
      const price = num(d.price);
      const cost = num(d.cost);
      if (!filled(d.price) || !filled(d.cost) || !(price > 0) || !(cost >= 0) || !Number.isFinite(cost)) {
        errs[c] = t("cpRowErr");
        continue;
      }
      let yieldRefTHa: number | null = null;
      if (filled(d.yield)) {
        yieldRefTHa = num(d.yield);
        if (!(yieldRefTHa > 0) || yieldRefTHa > 200) {
          errs[c] = t("cpYieldErr");
          continue;
        }
      }
      rows.push({ crop: c, pricePerT: price, variableCostPerHa: cost, yieldRefTHa });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!rows.length && !remove.length) return onSaved?.();
    save.mutate({ rows, remove });
  };

  const addable = data.crops
    .filter((c) => !list.includes(c.id))
    .map((c) => ({ value: c.id, label: c[locale] }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const other = data.rows.filter((r) => !r.usable).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        {data.canChangeCurrency ? (
          <Segmented<Currency>
            variant="compact"
            label={t("cpCurrency")}
            value={data.currency}
            onChange={(v) => v !== data.currency && currency.mutate(v)}
            options={[
              { value: "USD", label: "USD ($)" },
              { value: "UAH", label: "UAH (₴)" },
            ]}
          />
        ) : (
          <p className="text-body text-ink">
            <span className="font-semibold">{t("cpCurrency")}:</span> {data.currency}
          </p>
        )}
        <p className="max-w-prose text-small text-ink-2">
          {t("cpCurrencyNote")} {!data.canChangeCurrency && t("cpCurrencyOwner")}
        </p>
      </div>
      {other > 0 && <p className="text-small text-week">{t("cpOtherCurrency", { n: other })}</p>}
      <p className="text-small text-ink-2">{t("cpHelp")}</p>

      {list.length === 0 ? (
        <p className="text-small text-ink-2">{t("cpEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-small">
            <thead>
              <tr className="text-left text-ink-2">
                <th className="py-2 pr-3 font-semibold">{t("cpCrop")}</th>
                <th className="py-2 pr-3 font-semibold">{t("cpPrice", { cur: data.currency })}</th>
                <th className="py-2 pr-3 font-semibold">{t("cpCost", { cur: data.currency })}</th>
                <th className="py-2 font-semibold">{t("cpYield")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const d = cell(c);
                const hint = yieldHints[c];
                return (
                  <tr key={c} className="border-t border-line align-top">
                    <th scope="row" className="py-2 pr-3 text-left text-body font-semibold text-ink">
                      {name(c)}
                      {errors[c] && <p className="text-small font-normal text-urgent">{errors[c]}</p>}
                    </th>
                    <td className="py-2 pr-3">
                      <input
                        className={input}
                        inputMode="decimal"
                        aria-label={`${name(c)}: ${t("cpPrice", { cur: data.currency })}`}
                        aria-invalid={errors[c] ? true : undefined}
                        value={d.price}
                        onChange={(e) => set(c, "price", e.target.value)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className={input}
                        inputMode="decimal"
                        aria-label={`${name(c)}: ${t("cpCost", { cur: data.currency })}`}
                        aria-invalid={errors[c] ? true : undefined}
                        value={d.cost}
                        onChange={(e) => set(c, "cost", e.target.value)}
                      />
                    </td>
                    <td className="py-2">
                      <input
                        className={input}
                        inputMode="decimal"
                        aria-label={`${name(c)}: ${t("cpYield")}`}
                        value={d.yield}
                        onChange={(e) => set(c, "yield", e.target.value)}
                      />
                      {needYield.includes(c) && !filled(d.yield) && (
                        <p className="mt-1 text-small text-week">{t("cpYieldNeeded")}</p>
                      )}
                      {hint && (
                        <p className="mt-1 text-small text-ink-3">
                          {t("cpYieldHint", { v: hint.meanTHa, oblast: hint.oblast })}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {allowAdd && addable.length > 0 && (
        <SelectField
          className="max-w-xs"
          label={t("cpAdd")}
          value=""
          onChange={(e) => e.target.value && setList([...list, e.target.value])}
          options={[{ value: "", label: t("cpAddPick") }, ...addable]}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending}>
          {save.isPending ? t("cpSaving") : t("cpSave")}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t("cpCancel")}
          </Button>
        )}
        {saved && !save.isPending && (
          <span role="status" className="text-small text-ok">
            {t("cpSaved")}
          </span>
        )}
      </div>
    </div>
  );
}
