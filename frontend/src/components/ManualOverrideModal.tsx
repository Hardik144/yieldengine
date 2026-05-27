"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { ManualOverridePayload, QuoteRequest } from "@/lib/api";
import { formatCurrency, formatTimeShort } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface ManualOverrideModalProps {
  quote: QuoteRequest | null;
  onClose: () => void;
  onSubmitOverride: (
    quoteId: number,
    payload: ManualOverridePayload
  ) => Promise<void>;
}

export function ManualOverrideModal({
  quote,
  onClose,
  onSubmitOverride,
}: ManualOverrideModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [customPrice, setCustomPrice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync open/close state with native <dialog> showModal() API per modern-web-guidance `dialog`
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (quote) {
      // Pre-fill custom price with a suggested 16.5% margin target if currently <= 15%
      const impliedCarrierCost =
        quote.final_price * (1 - quote.profit_margin / 100);
      const suggestedPrice =
        quote.profit_margin <= 15
          ? (impliedCarrierCost / (1 - 0.165)).toFixed(2)
          : quote.final_price.toFixed(2);
      setCustomPrice(suggestedPrice);
      setNotes("");
      setErrorMsg(null);
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [quote]);

  // Fallback for browsers where <dialog closedby="any"> is not natively supported
  // and reset dialog.returnValue on close per modern-web-guidance `dialog`
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    let cleanupPointerFallback: (() => void) | undefined;
    if (
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      const isOutside = (e: PointerEvent, el: HTMLDialogElement) => {
        const r = el.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e, dialog);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e, dialog)) {
          dialog.close();
        }
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupPointerFallback = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (cleanupPointerFallback) cleanupPointerFallback();
    };
  }, [onClose]);

  if (!quote) {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby="override-dialog-title"
        {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      />
    );
  }

  const impliedCarrierCost =
    quote.final_price * (1 - quote.profit_margin / 100);
  const parsedPrice = Number.parseFloat(customPrice);
  const validPrice = Number.isFinite(parsedPrice) && parsedPrice > 0;
  const projectedMarginPct = validPrice
    ? ((parsedPrice - impliedCarrierCost) / parsedPrice) * 100
    : quote.profit_margin;

  const applyTargetMarginPreset = (targetMarginPct: number) => {
    const targetPrice = impliedCarrierCost / (1 - targetMarginPct / 100);
    setCustomPrice(targetPrice.toFixed(2));
  };

  const handleAction = async (
    targetStatus: "Manually Approved" | "Rejected"
  ) => {
    if (!validPrice) {
      setErrorMsg("Enter a valid positive override price in USD.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await onSubmitOverride(quote.id, {
        final_price: Number(parsedPrice.toFixed(2)),
        status: targetStatus,
        notes: notes.trim() || undefined,
      });
      dialogRef.current?.close();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to submit override"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="override-dialog-title"
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      className="w-full max-w-lg rounded-sm border border-amber-500/60 bg-[#0b101b] p-0 text-slate-100 shadow-2xl"
    >
      {/* Modal Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#070b14] px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <h2
            id="override-dialog-title"
            className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400"
          >
            MANUAL UNDERWRITER OVERRIDE // QUOTE #{quote.id}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close manual override dialog"
          className="rounded-sm p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Modal Body */}
      <div className="space-y-4 p-4 font-mono text-xs">
        {/* Quote Telemetry Summary */}
        <div className="grid grid-cols-2 gap-2 rounded-sm border border-slate-800 bg-[#06090f] p-3">
          <div>
            <span className="text-[10px] text-slate-400">ENTERPRISE CLIENT</span>
            <p className="mt-0.5 truncate font-sans text-xs font-semibold text-slate-100">
              {quote.client_name}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-slate-400">TRADE LANE</span>
            <p className="mt-0.5 truncate text-xs text-cyan-300">
              {quote.route}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-slate-400">CARGO WEIGHT</span>
            <p className="mt-0.5 text-slate-200 tabular-nums">
              {quote.cargo_weight.toFixed(2)} MT
            </p>
          </div>
          <div>
            <span className="text-[10px] text-slate-400">CURRENT STATUS</span>
            <div className="mt-0.5">
              <Badge
                variant={
                  quote.status === "Requires Review"
                    ? "requiresReview"
                    : "default"
                }
              >
                {quote.status} ({quote.profit_margin.toFixed(2)}%)
              </Badge>
            </div>
          </div>
        </div>

        {/* Pricing Cost Structure Breakdown */}
        <div className="grid grid-cols-3 gap-2 rounded-sm border border-slate-800/90 bg-slate-950/60 p-2.5 text-center">
          <div>
            <div className="text-[10px] text-slate-400">BASE RATE</div>
            <div className="mt-0.5 font-bold text-slate-200 tabular-nums">
              {formatCurrency(quote.base_rate)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">EST. CARRIER COST</div>
            <div className="mt-0.5 font-bold text-amber-300 tabular-nums">
              {formatCurrency(impliedCarrierCost)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-400">ALGO FINAL PRICE</div>
            <div className="mt-0.5 font-bold text-slate-100 tabular-nums">
              {formatCurrency(quote.final_price)}
            </div>
          </div>
        </div>

        {/* Custom Price Input & Quick Margin Presets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="override-final-price-input"
              className="text-[11px] font-semibold uppercase tracking-wider text-amber-300"
            >
              CUSTOM OVERRIDE FINAL PRICE (USD)
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => applyTargetMarginPreset(16.0)}
                className="rounded-sm border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500"
              >
                16% MARGIN
              </button>
              <button
                type="button"
                onClick={() => applyTargetMarginPreset(20.0)}
                className="rounded-sm border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500"
              >
                20% MARGIN
              </button>
              <button
                type="button"
                onClick={() => applyTargetMarginPreset(25.0)}
                className="rounded-sm border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:border-cyan-500"
              >
                25% MARGIN
              </button>
            </div>
          </div>

          <div className="relative">
            <DollarSign
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-amber-400"
              aria-hidden="true"
            />
            <Input
              id="override-final-price-input"
              type="number"
              step="0.01"
              min="1"
              autoFocus
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="h-9 pl-8 text-sm font-bold text-amber-300 tabular-nums"
            />
          </div>

          {/* Live Projected Margin Preview */}
          <div className="flex items-center justify-between rounded-sm border border-slate-800 bg-[#06090f] px-3 py-2">
            <span className="text-[11px] text-slate-400">
              PROJECTED PROFIT MARGIN:
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${
                projectedMarginPct > 15.0
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
            >
              {projectedMarginPct > 0 ? "+" : ""}
              {projectedMarginPct.toFixed(2)}%{" "}
              {projectedMarginPct > 15.0 ? "(>15% TARGET MET)" : "(≤15% FLOOR)"}
            </span>
          </div>
        </div>

        {/* Optional Underwriter Audit Note */}
        <div className="space-y-1">
          <label
            htmlFor="override-audit-notes"
            className="text-[10px] uppercase tracking-wider text-slate-400"
          >
            UNDERWRITER DESK NOTE (OPTIONAL)
          </label>
          <Input
            id="override-audit-notes"
            type="text"
            placeholder="e.g., Spot bunker surcharge adjusted per client SLA contract..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-sm border border-red-500/60 bg-red-950/60 px-3 py-2 text-xs text-red-200"
          >
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-red-400"
              aria-hidden="true"
            />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => dialogRef.current?.close()}
            disabled={submitting}
          >
            CANCEL (ESC)
          </Button>
          <Button
            type="button"
            variant="reject"
            onClick={() => handleAction("Rejected")}
            disabled={submitting}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>REJECT QUOTE</span>
          </Button>
          <Button
            type="button"
            variant="approve"
            onClick={() => handleAction("Manually Approved")}
            disabled={submitting}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>MANUALLY APPROVE</span>
          </Button>
        </div>
      </div>
    </dialog>
  );
}
