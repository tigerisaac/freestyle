import { Toggle } from "@renderer/components/voice-row";
import { cn } from "@renderer/lib/utils";
import { useTranslation } from "react-i18next";

import { Eyebrow } from "./page-chrome";
import type { ConfiguredModel } from "./types";
import type { EditMode } from "./use-models";
import { displayName } from "./utils";

// ---------------------------------------------------------------------------
// PairCard — the "current pair" hero: Voice (required) + LLM cleanup (optional)
// Side-by-side layout; each "Change" opens the shared model modal.
// ---------------------------------------------------------------------------

export function PairCard({
  voice,
  llm,
  llmCleanup,
  editMode,
  onToggleCleanup,
  onChangeVoice,
  onChangeLlm,
  onChangeEditMode,
  onConfigureWarming,
}: {
  voice: ConfiguredModel | undefined;
  llm: ConfiguredModel | undefined;
  llmCleanup: boolean;
  editMode: EditMode;
  onToggleCleanup: (next: boolean) => void;
  onChangeVoice: () => void;
  onChangeLlm: () => void;
  onChangeEditMode: (next: EditMode) => void;
  /** When set, shows a "Configure model warming" link by the voice button. */
  onConfigureWarming?: () => void;
}): React.JSX.Element {
  return (
    <section className="border-border bg-card grid grid-cols-1 gap-6 rounded-[14px] border p-6 min-[820px]:grid-cols-2">
      <PairSide
        kicker="Transcription · required"
        modelName={voice?.model_name}
        providerName={voice ? displayName(voice.provider) : undefined}
        cta="Change"
        primary
        onChange={onChangeVoice}
        accessory={
          onConfigureWarming ? (
            <button
              type="button"
              onClick={onConfigureWarming}
              className="text-primary ml-auto text-[12px] font-medium underline-offset-2 hover:underline"
            >
              Configure model warming
            </button>
          ) : undefined
        }
      />
      <div className="border-border border-t pt-6 min-[820px]:border-l min-[820px]:border-t-0 min-[820px]:pl-6 min-[820px]:pt-0">
        <PairSide
          kicker="AI cleanup · optional"
          modelName={llmCleanup ? llm?.model_name : undefined}
          providerName={
            llmCleanup && llm ? displayName(llm.provider) : undefined
          }
          cta={llm ? "Change" : "Pick a model"}
          toggle={llmCleanup}
          onToggle={onToggleCleanup}
          onChange={onChangeLlm}
          dimmed={!llmCleanup}
        />
        {llmCleanup && (
          <EditModeSelector mode={editMode} onChange={onChangeEditMode} />
        )}
      </div>
    </section>
  );
}

function EditModeSelector({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (next: EditMode) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const modes: { key: EditMode; label: string }[] = [
    { key: "strict", label: t("models.editModeStrict", "Strict") },
    { key: "default", label: t("models.editModeDefault", "Default") },
    { key: "extra", label: t("models.editModeExtra", "Extra") },
  ];

  return (
    <div className="mt-4 border-border border-t pt-4">
      <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wider">
        Editing style
      </div>
      <div className="border-border bg-secondary/40 flex rounded-lg border p-0.5">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(m.key)}
            className={cn(
              "flex-1 rounded-[6px] px-3 py-1.5 text-center text-[12.5px] font-medium transition-colors",
              mode === m.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PairSide({
  kicker,
  modelName,
  providerName,
  cta,
  primary,
  toggle,
  onToggle,
  onChange,
  dimmed,
  accessory,
}: {
  kicker: string;
  modelName: string | undefined;
  providerName: string | undefined;
  cta: string;
  primary?: boolean;
  toggle?: boolean;
  onToggle?: (next: boolean) => void;
  onChange: () => void;
  dimmed?: boolean;
  accessory?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 transition-opacity",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between">
        <Eyebrow text={kicker} accent={primary} mono={false} />
        {onToggle !== undefined && (
          <Toggle on={!!toggle} onChange={(v) => onToggle(v)} />
        )}
      </div>
      <div>
        {modelName ? (
          <div
            className="serif text-foreground"
            style={{
              fontSize: 34,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              fontWeight: 400,
            }}
          >
            {modelName}
          </div>
        ) : (
          <div
            className="serif-italic text-muted-foreground"
            style={{ fontSize: 30, lineHeight: 1.1 }}
          >
            None selected
          </div>
        )}
        {providerName && (
          <div className="text-muted-foreground mt-1.5 text-[13px]">
            via{" "}
            <span className="text-foreground/80 font-medium">
              {providerName}
            </span>
          </div>
        )}
      </div>
      <div className="mt-auto flex items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={onChange}
          className={cn(
            "rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition-colors",
            primary
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "border-border hover:bg-secondary border",
          )}
        >
          {cta}
        </button>
        {accessory}
      </div>
    </div>
  );
}
