"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented, SelectField, Surface, useToast } from "@terrasight/ui";
import { AlertCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { QueryState } from "@/components/QueryState";
import { api } from "@/lib/api";
import { useActionToast } from "@/lib/useActionToast";
import { useFormat } from "@/lib/useFormat";

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
const field =
  "focus-ring block w-full min-h-12 rounded-input border border-line-control bg-surface pl-3 pr-20 text-body text-ink placeholder:text-ink-3 aria-[invalid=true]:border-urgent";

/** Decimal input with its unit shown inside the field (currency per t, per ha, t/ha). */
function NumberField({
  label,
  unit,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-caption font-semibold text-ink">
        {label}
      </label>
      <span className="relative block">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={field}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption text-ink-2"
        >
          {unit}
        </span>
      </span>
    </div>
  );
}

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
  const s = useTranslations("Settings");
  return (
    <QueryState query={q} skeletonVariant="rows" what={s("pricesLoadWhat")}>
      {(data) => (
        <Table
          key={data.currency}
          workspaceId={workspaceId}
          data={data}
          crops={crops}
          allowAdd={allowAdd}
          yieldHints={yieldHints}
          needYield={needYield}
          onSaved={onSaved}
          onCancel={onCancel}
        />
      )}
    </QueryState>
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
  const s = useTranslations("Settings");
  const f = useFormat();
  const toast = useToast();
  const action = useActionToast();
  const usable = data.rows.filter((r) => r.usable);
  const name = (id: string) => data.crops.find((c) => c.id === id)?.[locale] ?? s("cropFallback");
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
  const cell = (c: string) => draft[c] ?? { price: "", cost: "", yield: "" };
  const set = (c: string, k: "price" | "cost" | "yield", v: string) => {
    setDraft({ ...draft, [c]: { ...cell(c), [k]: v } });
  };
  const hadRow = new Set(usable.map((r) => r.crop));

  const currency = useMutation({
    mutationFn: (value: Currency) =>
      api(`/api/w/${workspaceId}`, { method: "PATCH", body: { currency: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crop-prices", workspaceId] }),
    onError: (e, value) => action.fail(e, s("currencyChangeFail"), () => currency.mutate(value)),
  });
  const save = useMutation({
    mutationFn: (body: { rows: unknown[]; remove: string[] }) =>
      api(`/api/w/${workspaceId}/crop-prices`, { method: "PUT", body }),
    onSuccess: () => {
      toast.show(s("pricesSavedToast"), "info");
      void qc.invalidateQueries({ queryKey: ["crop-prices", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["scenarios", workspaceId] });
      onSaved?.();
    },
    onError: (e, body) => action.fail(e, s("pricesSaveFail"), () => save.mutate(body)),
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
      <p className="text-small text-ink-2">{s("pricesAgronomyOnly")}</p>

      {list.length === 0 ? (
        <p className="text-small text-ink-2">{t("cpEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((c) => {
            const d = cell(c);
            const hint = yieldHints[c];
            const errId = `err-${c}`;
            return (
              <li key={c}>
                <Surface tone="inset" pad="sm" className="flex flex-col gap-3">
                  <h3 className="text-body font-semibold text-ink">{name(c)}</h3>
                  {errors[c] && (
                    <p id={errId} role="alert" className="flex items-start gap-2 text-small text-urgent">
                      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span>{errors[c]}</span>
                    </p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumberField
                      label={t("cpPrice", { cur: data.currency })}
                      unit={s("priceUnit", { cur: data.currency })}
                      value={d.price}
                      onChange={(v) => set(c, "price", v)}
                      invalid={!!errors[c]}
                      describedBy={errors[c] ? errId : undefined}
                    />
                    <NumberField
                      label={t("cpCost", { cur: data.currency })}
                      unit={s("costUnit", { cur: data.currency })}
                      value={d.cost}
                      onChange={(v) => set(c, "cost", v)}
                      invalid={!!errors[c]}
                      describedBy={errors[c] ? errId : undefined}
                    />
                    <NumberField
                      label={t("cpYield")}
                      unit="t/ha"
                      value={d.yield}
                      onChange={(v) => set(c, "yield", v)}
                    />
                  </div>
                  {needYield.includes(c) && !filled(d.yield) && (
                    <p className="text-small text-week">{t("cpYieldNeeded")}</p>
                  )}
                  {hint && (
                    <p className="text-small text-ink-2">
                      {t("cpYieldHint", { v: f.number(hint.meanTHa), oblast: hint.oblast })}
                    </p>
                  )}
                </Surface>
              </li>
            );
          })}
        </ul>
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
      </div>
    </div>
  );
}
