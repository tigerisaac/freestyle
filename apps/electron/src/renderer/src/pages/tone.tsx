import {
  CLEANUP_CUSTOM_PROMPT_MAX,
  CLEANUP_PRESET_PROMPTS,
  type CleanupAppAssignment,
  type CleanupEmailTone,
  type CleanupIntensity,
  type CleanupOverallTone,
  type CleanupPersonalTone,
  type CleanupToneDestination,
  type CleanupWorkTone,
  parseCleanupAppAssignments,
  parseCleanupEmailTone,
  parseCleanupIntensity,
  parseCleanupOverallTone,
  parseCleanupPersonalTone,
  parseCleanupWorkTone,
} from "@freestyle-voice/validations";
import { AppAssignments } from "@renderer/components/tone-previews/app-assignments";
import {
  type AppMarkId,
  AppMarkRow,
} from "@renderer/components/tone-previews/app-marks";
import { CleanupPreview } from "@renderer/components/tone-previews/cleanup-preview";
import { EmailPreview } from "@renderer/components/tone-previews/email-preview";
import { NotePreview } from "@renderer/components/tone-previews/note-preview";
import {
  getVisibleBuiltinRouteIds,
  normalizeManagedAssignments,
} from "@renderer/components/tone-previews/route-ownership";
import { TextMessagePreview } from "@renderer/components/tone-previews/text-message-preview";
import { WorkChatPreview } from "@renderer/components/tone-previews/work-chat-preview";
import { Button } from "@renderer/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs";
import { Textarea } from "@renderer/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@renderer/components/ui/toggle-group";
import { usePersistentState } from "@renderer/hooks/use-persistent-state";
import { getClient } from "@renderer/lib/api";
import { useCloudAuth } from "@renderer/lib/auth-context";
import type { AvailableModel } from "@renderer/lib/models";
import { SETTINGS_QUERY_KEY, settingsQueryOptions } from "@renderer/lib/query";
import { cn } from "@renderer/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  DEFAULT_CLEANUP_EMAIL_TONE,
  DEFAULT_CLEANUP_OVERALL_TONE,
  DEFAULT_CLEANUP_PERSONAL_TONE,
  DEFAULT_CLEANUP_WORK_TONE,
} from "../../../shared/cleanup-tone-settings";
import { SETTINGS_KEYS } from "../../../shared/settings-keys";
import { PageHeader, PageShell } from "./models/page-chrome";
import type { ConfiguredModel } from "./models/types";

type ToneTab =
  | "cleanup"
  | Exclude<CleanupToneDestination, "overall">
  | "everythingElse";

const TONE_TABS: readonly [ToneTab, string][] = [
  ["cleanup", "tone.tabs.cleanup"],
  ["personal", "tone.tabs.personal"],
  ["work", "tone.tabs.work"],
  ["email", "tone.tabs.email"],
  ["everythingElse", "tone.tabs.everythingElse"],
];

const isToneTab = (value: string): value is ToneTab =>
  TONE_TABS.some(([tab]) => tab === value);

const FREESTYLE_CLOUD_PROVIDER = "freestyle-cloud";

type CleanupCardValue = CleanupIntensity;

type ToneOption<T extends string> = {
  value: T;
  titleKey: string;
  /** The result this option produces for the tab's shared raw transcript. */
  sampleKey: string;
};

const CLEANUP_OPTIONS: ToneOption<CleanupCardValue>[] = [
  {
    value: "low",
    titleKey: "tone.cleanup.cards.low.title",
    sampleKey: "tone.cleanup.cards.low.sample",
  },
  {
    value: "medium",
    titleKey: "tone.cleanup.cards.medium.title",
    sampleKey: "tone.cleanup.cards.medium.sample",
  },
  {
    value: "high",
    titleKey: "tone.cleanup.cards.high.title",
    sampleKey: "tone.cleanup.cards.high.sample",
  },
  {
    value: "custom",
    titleKey: "tone.cleanup.cards.custom.title",
    sampleKey: "tone.cleanup.cards.custom.sample",
  },
];

const PERSONAL_OPTIONS: ToneOption<CleanupPersonalTone>[] = [
  {
    value: "polished",
    titleKey: "tone.personal.cards.polished.title",
    sampleKey: "tone.personal.cards.polished.sample",
  },
  {
    value: "casual",
    titleKey: "tone.personal.cards.casual.title",
    sampleKey: "tone.personal.cards.casual.sample",
  },
  {
    value: "very_casual",
    titleKey: "tone.personal.cards.very_casual.title",
    sampleKey: "tone.personal.cards.very_casual.sample",
  },
  {
    value: "off",
    titleKey: "tone.personal.cards.off.title",
    sampleKey: "tone.personal.cards.off.sample",
  },
];

const WORK_OPTIONS: ToneOption<CleanupWorkTone>[] = [
  {
    value: "direct",
    titleKey: "tone.work.cards.direct.title",
    sampleKey: "tone.work.cards.direct.sample",
  },
  {
    value: "friendly",
    titleKey: "tone.work.cards.friendly.title",
    sampleKey: "tone.work.cards.friendly.sample",
  },
  {
    value: "formal",
    titleKey: "tone.work.cards.formal.title",
    sampleKey: "tone.work.cards.formal.sample",
  },
  {
    value: "off",
    titleKey: "tone.work.cards.off.title",
    sampleKey: "tone.work.cards.off.sample",
  },
];

const EMAIL_OPTIONS: ToneOption<CleanupEmailTone>[] = [
  {
    value: "casual",
    titleKey: "tone.email.cards.casual.title",
    sampleKey: "tone.email.cards.casual.sample",
  },
  {
    value: "warm",
    titleKey: "tone.email.cards.warm.title",
    sampleKey: "tone.email.cards.warm.sample",
  },
  {
    value: "formal",
    titleKey: "tone.email.cards.formal.title",
    sampleKey: "tone.email.cards.formal.sample",
  },
  {
    value: "off",
    titleKey: "tone.email.cards.off.title",
    sampleKey: "tone.email.cards.off.sample",
  },
];

const OVERALL_OPTIONS: ToneOption<CleanupOverallTone>[] = [
  {
    value: "casual",
    titleKey: "tone.everythingElse.cards.casual.title",
    sampleKey: "tone.everythingElse.cards.casual.sample",
  },
  {
    value: "neutral",
    titleKey: "tone.everythingElse.cards.neutral.title",
    sampleKey: "tone.everythingElse.cards.neutral.sample",
  },
  {
    value: "professional",
    titleKey: "tone.everythingElse.cards.professional.title",
    sampleKey: "tone.everythingElse.cards.professional.sample",
  },
  {
    value: "off",
    titleKey: "tone.everythingElse.cards.off.title",
    sampleKey: "tone.everythingElse.cards.off.sample",
  },
];

export default function TonePage(): React.JSX.Element {
  const { t } = useTranslation();
  const cloudAuth = useCloudAuth();
  const queryClient = useQueryClient();
  const [llmCleanup, setLlmCleanup] = useState(false);
  const [cleanupIntensity, setCleanupIntensity] =
    useState<CleanupIntensity>("medium");
  const [cleanupCustomPrompt, setCleanupCustomPrompt] = useState("");
  const [savedCleanupCustomPrompt, setSavedCleanupCustomPrompt] = useState("");
  const [savingCustomPrompt, setSavingCustomPrompt] = useState(false);
  const [personalTone, setPersonalTone] = useState<CleanupPersonalTone>(
    DEFAULT_CLEANUP_PERSONAL_TONE,
  );
  const [workTone, setWorkTone] = useState<CleanupWorkTone>(
    DEFAULT_CLEANUP_WORK_TONE,
  );
  const [emailTone, setEmailTone] = useState<CleanupEmailTone>(
    DEFAULT_CLEANUP_EMAIL_TONE,
  );
  const [overallTone, setOverallTone] = useState<CleanupOverallTone>(
    DEFAULT_CLEANUP_OVERALL_TONE,
  );
  const [assignments, setAssignments] = useState<CleanupAppAssignment[]>([]);
  const [usingCloud, setUsingCloud] = useState(false);
  const [activeTab, setActiveTab] = usePersistentState<ToneTab>(
    "tone.activeTab",
    "cleanup",
    isToneTab,
  );

  const customPromptDirty = cleanupCustomPrompt !== savedCleanupCustomPrompt;

  const settingsQuery = useQuery(settingsQueryOptions());

  const configuredQuery = useQuery({
    queryKey: ["models", "configured"],
    queryFn: async () => {
      const res = await getClient().api.models.configured.$get();
      if (!res.ok) throw new Error("Failed to load configured models");
      return (await res.json()) as ConfiguredModel[];
    },
  });

  const loading = settingsQuery.isLoading || configuredQuery.isLoading;

  // Whether a default cleanup (LLM) model is configured — drives the banners.
  const hasCleanupModel = useMemo(
    () =>
      (configuredQuery.data ?? []).some(
        (model) => model.type === "llm" && model.is_default === 1,
      ),
    [configuredQuery.data],
  );

  // Seed editable tone/cleanup state from persisted settings once. Save
  // handlers update local state directly, so we don't re-seed on later
  // invalidations (which would clobber in-progress edits).
  const seededRef = useRef(false);
  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings || seededRef.current) return;
    seededRef.current = true;

    setLlmCleanup(settings[SETTINGS_KEYS.llmCleanup] === "true");
    setCleanupIntensity(
      parseCleanupIntensity(settings[SETTINGS_KEYS.cleanupIntensity]),
    );
    const prompt = settings[SETTINGS_KEYS.cleanupCustomPrompt];
    if (typeof prompt === "string") {
      setCleanupCustomPrompt(prompt);
      setSavedCleanupCustomPrompt(prompt);
    }
    setPersonalTone(
      parseCleanupPersonalTone(settings[SETTINGS_KEYS.cleanupPersonalTone]),
    );
    setWorkTone(parseCleanupWorkTone(settings[SETTINGS_KEYS.cleanupWorkTone]));
    setEmailTone(
      parseCleanupEmailTone(settings[SETTINGS_KEYS.cleanupEmailTone]),
    );
    setOverallTone(
      parseCleanupOverallTone(settings[SETTINGS_KEYS.cleanupOverallTone]),
    );
    setAssignments(
      normalizeManagedAssignments(
        parseCleanupAppAssignments(
          settings[SETTINGS_KEYS.cleanupAppAssignments],
        ),
      ),
    );
  }, [settingsQuery.data]);

  const reload = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["models", "configured"] }),
      ]),
    [queryClient],
  );

  const saveSetting = useCallback(async (key: string, value: string) => {
    // The Hono client does not throw on non-2xx — surface server rejections so
    // callers' .catch handlers fire (and "Saved" state isn't shown on failure).
    const res = await getClient().api.settings[":key"].$put({
      param: { key },
      json: { value },
    });
    if (!res.ok) {
      throw new Error(`Failed to save setting "${key}" (${res.status})`);
    }
  }, []);

  // Turn cleanup on by wiring Freestyle Cloud as the cleanup model. Requires a
  // signed-in cloud session; mirrors the Models page "Use Freestyle Cloud" flow.
  const onUseCloud = useCallback(async () => {
    if (usingCloud) return;
    setUsingCloud(true);
    try {
      const authed = cloudAuth.user
        ? !!(await cloudAuth.refresh())
        : !!(await cloudAuth.signIn());
      if (!authed) return;

      const client = getClient();
      const availRes = await client.api.models.available.$get();
      if (!availRes.ok) return;
      const models = (await availRes.json()) as AvailableModel[];
      const cloudLlm = models.find(
        (model) =>
          model.type === "llm" &&
          model.provider_id === FREESTYLE_CLOUD_PROVIDER,
      );
      if (!cloudLlm) return;

      // Configure the cloud cleanup model first; only flip llm_cleanup on once
      // the model is actually persisted, otherwise cleanup would be "enabled"
      // with no model behind it (server silently returns raw text).
      const configRes = await client.api.models.configured.$post({
        json: {
          provider: cloudLlm.provider_id,
          model_id: cloudLlm.model_id,
          model_name: cloudLlm.model_name,
          type: "llm",
          is_default: true,
        },
      });
      if (!configRes.ok) {
        console.error(
          `Failed to configure Freestyle Cloud cleanup model (${configRes.status})`,
        );
        return;
      }

      await saveSetting(SETTINGS_KEYS.llmCleanup, "true");
      setLlmCleanup(true);
      await reload();
    } catch (err) {
      console.error("Failed to enable cleanup:", err);
    } finally {
      setUsingCloud(false);
    }
  }, [cloudAuth, reload, saveSetting, usingCloud]);

  const selectCleanupMode = useCallback(
    (next: CleanupCardValue) => {
      // Enablement lives on the Models page now — this only picks the strength.
      if (next === "custom" && cleanupIntensity !== "custom") {
        const seed =
          cleanupCustomPrompt.trim() ||
          CLEANUP_PRESET_PROMPTS[cleanupIntensity];
        setCleanupCustomPrompt(seed);
      }

      setCleanupIntensity(next);
      saveSetting(SETTINGS_KEYS.cleanupIntensity, next).catch((err) =>
        console.error("Failed to save cleanup strength:", err),
      );
    },
    [cleanupCustomPrompt, cleanupIntensity, saveSetting],
  );

  const saveCleanupCustomPrompt = useCallback(async () => {
    const value = cleanupCustomPrompt;
    setSavingCustomPrompt(true);
    try {
      await saveSetting(SETTINGS_KEYS.cleanupCustomPrompt, value);
      setSavedCleanupCustomPrompt(value);
    } catch (err) {
      console.error("Failed to save cleanup custom prompt:", err);
    } finally {
      setSavingCustomPrompt(false);
    }
  }, [cleanupCustomPrompt, saveSetting]);

  const resetToPresetMode = useCallback(() => {
    selectCleanupMode("low");
  }, [selectCleanupMode]);

  const savePersonalTone = useCallback(
    (value: CleanupPersonalTone) => {
      setPersonalTone(value);
      saveSetting(SETTINGS_KEYS.cleanupPersonalTone, value).catch((err) =>
        console.error("Failed to save personal tone:", err),
      );
    },
    [saveSetting],
  );

  const saveWorkTone = useCallback(
    (value: CleanupWorkTone) => {
      setWorkTone(value);
      saveSetting(SETTINGS_KEYS.cleanupWorkTone, value).catch((err) =>
        console.error("Failed to save work tone:", err),
      );
    },
    [saveSetting],
  );

  const saveEmailTone = useCallback(
    (value: CleanupEmailTone) => {
      setEmailTone(value);
      saveSetting(SETTINGS_KEYS.cleanupEmailTone, value).catch((err) =>
        console.error("Failed to save email tone:", err),
      );
    },
    [saveSetting],
  );

  const saveOverallTone = useCallback(
    (value: CleanupOverallTone) => {
      setOverallTone(value);
      saveSetting(SETTINGS_KEYS.cleanupOverallTone, value).catch((err) =>
        console.error("Failed to save everything-else tone:", err),
      );
    },
    [saveSetting],
  );

  const persistAssignments = useCallback(
    (next: CleanupAppAssignment[]) => {
      const normalized = normalizeManagedAssignments(next);
      setAssignments(normalized);
      saveSetting(
        SETTINGS_KEYS.cleanupAppAssignments,
        JSON.stringify(normalized),
      ).catch((err) => console.error("Failed to save app assignments:", err));
    },
    [saveSetting],
  );

  const addAssignment = useCallback(
    (assignment: CleanupAppAssignment) => {
      // A given app/site maps to exactly one group — a re-add moves it.
      persistAssignments([
        ...assignments.filter((a) => a.match !== assignment.match),
        assignment,
      ]);
    },
    [assignments, persistAssignments],
  );

  const removeAssignment = useCallback(
    (match: string) => {
      persistAssignments(assignments.filter((a) => a.match !== match));
    },
    [assignments, persistAssignments],
  );

  const cleanupMode: CleanupCardValue = cleanupIntensity;

  // Each tab shows its own current value, so the tab row doubles as the summary
  // of every tone setting — no need to open all five to see where you stand.
  const tabValues: Record<ToneTab, string> = {
    cleanup: optionTitle(t, CLEANUP_OPTIONS, cleanupMode),
    personal: optionTitle(t, PERSONAL_OPTIONS, personalTone),
    work: optionTitle(t, WORK_OPTIONS, workTone),
    email: optionTitle(t, EMAIL_OPTIONS, emailTone),
    everythingElse: optionTitle(t, OVERALL_OPTIONS, overallTone),
  };

  if (loading) {
    return (
      <PageShell>
        <div className="mx-auto w-full max-w-[760px]">
          <div className="flex items-center justify-center py-24">
            <p className="text-muted-foreground text-sm">{t("tone.loading")}</p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto w-full max-w-[760px]">
        <PageHeader title={t("tone.title")} subtitle={t("tone.subtitle")} />

        {!llmCleanup ? (
          <CleanupDisabledBanner
            signedIn={!!cloudAuth.user}
            busy={usingCloud}
            onUseCloud={() => void onUseCloud()}
          />
        ) : !hasCleanupModel ? (
          <CleanupNoModelBanner />
        ) : null}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ToneTab)}
          className="mt-7 gap-0"
        >
          <TabsList
            variant="line"
            className="border-border h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b bg-transparent p-0"
          >
            {TONE_TABS.map(([value, key]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-auto flex-none flex-col items-start gap-[3px] rounded-none px-3.5 pt-0 pb-2.5 text-[13px] first:pl-0 after:bottom-[-1px]"
              >
                {t(key)}
                <span
                  className={cn(
                    "text-[11px] font-normal",
                    activeTab === value
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {tabValues[value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="cleanup">
            <CleanupTonePanel
              value={cleanupMode}
              onChange={selectCleanupMode}
              cleanupCustomPrompt={cleanupCustomPrompt}
              onCustomPromptChange={setCleanupCustomPrompt}
              customPromptDirty={customPromptDirty}
              onSaveCustomPrompt={() => void saveCleanupCustomPrompt()}
              onResetToPreset={resetToPresetMode}
              savingCustomPrompt={savingCustomPrompt}
            />
          </TabsContent>

          <TabsContent value="personal">
            <SubsetTonePanel
              destination="personal"
              previewKind="personal"
              label={t("tone.tabs.personal")}
              apps={getVisibleBuiltinRouteIds("personal", assignments)}
              value={personalTone}
              options={PERSONAL_OPTIONS}
              onChange={savePersonalTone}
              assignments={assignments.filter(
                (a) => a.destination === "personal",
              )}
              allAssignments={assignments}
              onAddAssignment={addAssignment}
              onRemoveAssignment={removeAssignment}
            />
          </TabsContent>

          <TabsContent value="work">
            <SubsetTonePanel
              destination="work"
              previewKind="work"
              label={t("tone.tabs.work")}
              apps={getVisibleBuiltinRouteIds("work", assignments)}
              value={workTone}
              options={WORK_OPTIONS}
              onChange={saveWorkTone}
              assignments={assignments.filter((a) => a.destination === "work")}
              allAssignments={assignments}
              onAddAssignment={addAssignment}
              onRemoveAssignment={removeAssignment}
            />
          </TabsContent>

          <TabsContent value="email">
            <SubsetTonePanel
              destination="email"
              previewKind="email"
              label={t("tone.tabs.email")}
              apps={getVisibleBuiltinRouteIds("email", assignments)}
              value={emailTone}
              options={EMAIL_OPTIONS}
              onChange={saveEmailTone}
              assignments={assignments.filter((a) => a.destination === "email")}
              allAssignments={assignments}
              onAddAssignment={addAssignment}
              onRemoveAssignment={removeAssignment}
            />
          </TabsContent>

          <TabsContent value="everythingElse">
            <SubsetTonePanel
              destination="overall"
              previewKind="overall"
              label={t("tone.tabs.everythingElse")}
              apps={[]}
              value={overallTone}
              options={OVERALL_OPTIONS}
              onChange={saveOverallTone}
              assignments={assignments.filter(
                (a) => a.destination === "overall",
              )}
              allAssignments={assignments}
              onAddAssignment={addAssignment}
              onRemoveAssignment={removeAssignment}
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

function optionTitle<T extends string>(
  t: (key: string) => string,
  options: ToneOption<T>[],
  value: T,
): string {
  const option = options.find((o) => o.value === value) ?? options[0]!;
  return t(option.titleKey);
}

// ---------------------------------------------------------------------------
// Choosing a tone
// ---------------------------------------------------------------------------

/**
 * Pointing at an option shows it in the example; the committed value comes back
 * when the pointer leaves. Restoring is delayed so that travelling across the
 * gap between two chips doesn't flash the committed sample in between.
 */
function useHoverPreview<T extends string>(
  committed: T,
): [T, (value: T | null) => void] {
  const [hovered, setHovered] = useState<T | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    [],
  );

  const preview = useCallback((value: T | null) => {
    if (restoreTimer.current) {
      clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    if (value === null) {
      restoreTimer.current = setTimeout(() => setHovered(null), 160);
      return;
    }
    setHovered(value);
  }, []);

  return [hovered ?? committed, preview];
}

function ToneChips<T extends string>({
  label,
  options,
  value,
  onChange,
  onPreview,
  disabled,
}: {
  label: string;
  options: ToneOption<T>[];
  value: T;
  onChange: (value: T) => void;
  onPreview: (value: T | null) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix allows deselecting the active item; a tone must always be set.
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      disabled={disabled}
      spacing={1.5}
      className={cn("mt-5 flex-wrap", disabled && "opacity-50")}
      onMouseLeave={() => onPreview(null)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          variant="outline"
          onMouseEnter={() => onPreview(option.value)}
          onFocus={() => onPreview(option.value)}
          onBlur={() => onPreview(null)}
          className="text-muted-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground rounded-full px-3.5 text-[13px] font-normal"
        >
          {t(option.titleKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Every option's example is rendered, stacked in one grid cell, and only the
 * shown one is visible. The stage is therefore always as tall as the tallest
 * example, so moving between options cross-fades in place instead of resizing
 * the page under the pointer.
 */
function ToneStage<T extends string>({
  options,
  shown,
  render,
}: {
  options: ToneOption<T>[];
  shown: T;
  render: (option: ToneOption<T>) => React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-5 grid">
      {options.map((option) => {
        const visible = option.value === shown;
        return (
          <div
            key={option.value}
            aria-hidden={!visible}
            inert={!visible}
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-150",
              visible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {render(option)}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

// Shown across every Tone tab while post-processing is off. Cleanup enablement
// now lives on the Models page, so this points users there (and offers a
// one-click Freestyle Cloud path when signed in).
function CleanupDisabledBanner({
  signedIn,
  busy,
  onUseCloud,
}: {
  signedIn: boolean;
  busy: boolean;
  onUseCloud: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ToneNotice
      title={t("tone.disabledBanner.title")}
      desc={t("tone.disabledBanner.desc")}
    >
      {signedIn ? (
        <Button variant="ink" size="sm" onClick={onUseCloud} disabled={busy}>
          {busy
            ? t("tone.disabledBanner.useCloudBusy")
            : t("tone.disabledBanner.useCloud")}
        </Button>
      ) : null}
      <Button asChild variant="outline" size="sm">
        <Link to="/settings/models">{t("tone.disabledBanner.goToModels")}</Link>
      </Button>
    </ToneNotice>
  );
}

// Cleanup is enabled but no LLM model is configured, so nothing actually runs.
// Shown across every Tone tab (not just the Cleanup tab) since the tone
// selectors have no effect until a model is picked.
function CleanupNoModelBanner(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ToneNotice
      title={t("tone.cleanup.noModelTitle")}
      desc={t("tone.cleanup.noModelDesc")}
    >
      <Button asChild variant="outline" size="sm">
        <Link to="/settings/models">{t("tone.cleanup.noModelCta")}</Link>
      </Button>
    </ToneNotice>
  );
}

// A terracotta rule rather than a boxed banner — states that the page is inert
// without competing with the example below it.
function ToneNotice({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="border-destructive/70 mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-l-2 pl-4">
      <div className="min-w-0">
        <p className="text-foreground text-[13px] font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-[12.5px] leading-[1.5]">
          {desc}
        </p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function CleanupTonePanel({
  value,
  onChange,
  cleanupCustomPrompt,
  onCustomPromptChange,
  customPromptDirty,
  onSaveCustomPrompt,
  onResetToPreset,
  savingCustomPrompt,
  disabled,
}: {
  value: CleanupCardValue;
  onChange: (value: CleanupCardValue) => void;
  cleanupCustomPrompt: string;
  onCustomPromptChange: (value: string) => void;
  customPromptDirty: boolean;
  onSaveCustomPrompt: () => void;
  onResetToPreset: () => void;
  savingCustomPrompt: boolean;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [shown, preview] = useHoverPreview(value);

  return (
    <div>
      <ToneChips
        label={t("tone.tabs.cleanup")}
        options={CLEANUP_OPTIONS}
        value={value}
        onChange={onChange}
        onPreview={preview}
        disabled={disabled}
      />

      {value === "custom" ? (
        // Committed to custom rules: the editor replaces the example, since
        // there is nothing to preview until the rules are written.
        <div
          className={cn("mt-5", disabled && "pointer-events-none opacity-50")}
        >
          <Textarea
            value={cleanupCustomPrompt}
            maxLength={CLEANUP_CUSTOM_PROMPT_MAX}
            onChange={(event) => onCustomPromptChange(event.target.value)}
            spellCheck={false}
            disabled={disabled}
            className="mono min-h-[150px] resize-y text-[12px] leading-[1.65]"
            aria-label={t("models.cleanup.promptLabel")}
          />
          <div className="text-muted-foreground mt-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
            <span>{t("models.cleanup.customHint")}</span>
            <span className="flex items-center gap-3">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={onResetToPreset}
                disabled={disabled}
              >
                {t("models.cleanup.resetToPresets")}
              </Button>
              <Button
                variant="ink"
                size="sm"
                onClick={onSaveCustomPrompt}
                disabled={disabled || savingCustomPrompt || !customPromptDirty}
              >
                {savingCustomPrompt ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {t("models.cleanup.saving")}
                  </>
                ) : customPromptDirty ? (
                  t("models.cleanup.save")
                ) : (
                  <>
                    <Check />
                    {t("models.cleanup.saved")}
                  </>
                )}
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <ToneStage
          options={CLEANUP_OPTIONS}
          shown={shown}
          render={(option) => (
            <CleanupPreview result={t(option.sampleKey)} selected={false} />
          )}
        />
      )}
    </div>
  );
}

function SubsetTonePanel<T extends string>({
  destination,
  previewKind,
  label,
  apps,
  value,
  options,
  onChange,
  assignments,
  allAssignments,
  onAddAssignment,
  onRemoveAssignment,
  disabled,
}: {
  destination: CleanupToneDestination;
  previewKind: "personal" | "work" | "email" | "overall";
  label: string;
  apps: readonly AppMarkId[];
  value: T;
  options: ToneOption<T>[];
  onChange: (value: T) => void;
  assignments: CleanupAppAssignment[];
  allAssignments: CleanupAppAssignment[];
  onAddAssignment: (assignment: CleanupAppAssignment) => void;
  onRemoveAssignment: (match: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [shown, preview] = useHoverPreview(value);
  // "Everything else" is the catch-all destination — it owns whatever nothing
  // else claims, so there is nothing to route into it.
  const canManageRoutes = destination !== "overall";

  const renderSurface = (option: ToneOption<T>): React.ReactNode => {
    const sample = t(option.sampleKey);
    // "Off" applies no destination styling, so it shows as plain text rather
    // than dressed in the app's chrome.
    if (option.value === "off" || previewKind === "overall") {
      return <NotePreview sample={sample} selected={false} />;
    }
    if (previewKind === "personal") {
      return <TextMessagePreview sample={sample} selected={false} />;
    }
    if (previewKind === "work") {
      return (
        <WorkChatPreview
          sample={sample}
          selected={false}
          sender={t("tone.work.preview.sender")}
          time={t("tone.work.preview.time")}
        />
      );
    }
    return (
      <EmailPreview
        body={sample}
        selected={false}
        to={t("tone.email.preview.to")}
        subject={t("tone.email.preview.subject")}
      />
    );
  };

  return (
    <div>
      {canManageRoutes || assignments.length > 0 ? (
        <AppMarkRow
          ids={apps}
          assignments={assignments}
          size={26}
          className="mt-5"
          trailing={
            canManageRoutes ? (
              <AppAssignments
                destination={destination}
                items={assignments}
                allItems={allAssignments}
                onAdd={onAddAssignment}
                onRemove={onRemoveAssignment}
              />
            ) : undefined
          }
        />
      ) : null}

      <ToneChips
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        onPreview={preview}
        disabled={disabled}
      />

      <ToneStage options={options} shown={shown} render={renderSurface} />
    </div>
  );
}
