import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BadgeCheck, ChevronLeft, ChevronRight, Eye, Shirt, Sparkles, UserRound } from "lucide-react";
import { API } from "@/api";
import { cn } from "cn";
import { CrossfadeImage } from "@/components/canvas/shared/CrossfadeImage";
import { CopyButton } from "@/components/shared/CopyButton";
import { useLeaveGuard } from "@/components/shared/edit-unit/LeaveGuard";
import { UnsavedChangesBar } from "@/components/shared/edit-unit/UnsavedChangesBar";
import { useEditUnit } from "@/components/shared/edit-unit/useEditUnit";
import { PromptPreviewButton } from "@/components/shared/PromptPreviewButton";
import { Button } from "@/components/ui/button";
import { SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useProjectsStore } from "@/stores/projects-store";
import { DEFAULT_CHARACTER_VOICE_BINDING } from "@/types";
import type { AssetSheetStatusRow, Character } from "@/types";
import { errMsg } from "@/utils/async";
import { refreshAfterWrite } from "@/components/canvas/shared/refreshAfterWrite";
import { ASSET_TYPE_ICON } from "./AssetBrowseCard";
import { rejectIfAssetBusy, useAssetBusyNames } from "./assetBusyGuard";
import { AssetAliasesField } from "./AssetAliasesField";
import { AssetImageDialog } from "./AssetImageDialog";
import { AssetOriginalsField } from "./AssetOriginalsField";
import { hasUsableDescription } from "./AssetSheetStatusBadge";
import {
  assetFieldsEqual,
  assetFieldsOf,
  assetFieldsPatch,
  normalizeAssetFields,
  updateAssetFields,
  type AssetFields,
} from "./asset-editor-model";
import { CharacterDerivativesField } from "./CharacterDerivativesField";
import { CharacterVoiceField } from "./CharacterVoiceField";
import { EditableAssetName } from "./EditableAssetName";
import { markerOf, toGalleryAsset, type GalleryAssetSource } from "./gallery-model";
import { GalleryStatusMarker } from "./GalleryStatusMarker";
import { GenerateButton } from "./GenerateButton";
import { AssetWriteProvider, useAssetWrites } from "./useAssetWrites";
import { useStaleRegenerateConfirm } from "./useStaleRegenerateConfirm";

/** 顶栏翻页：当前角色在画廊顺序里的位置与上下一个。 */
export interface StudioPager {
  /** 1 起。 */
  index: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export interface CharacterStudioProps {
  projectName: string;
  name: string;
  asset: GalleryAssetSource;
  sheetStatus: AssetSheetStatusRow | undefined;
  generating: boolean;
  writing?: boolean;
  readOnly: boolean;
  onGenerate: (name: string) => unknown;
  /** 改名已提交时调用。 */
  onRenamed: (from: string, to: string) => void;
  /** 返回角色列表。 */
  onClose: () => void;
  pager?: StudioPager | null;
}

/**
 * 角色工作室：整屏三栏。左栏主形象（资产图 + 参考图 + 组装后的生成提示词），中栏角色设定
 * （名称、别名、描述、声音、引用记号），右栏造型（复用角色详情的衍生区块）。一个角色是一个编辑单元：
 * 描述与声音风格进入未保存修改，在设定栏底部的修改条统一保存；上传、改名、增删别名与衍生态照旧立即执行。
 */
export function CharacterStudio({
  projectName,
  name,
  asset,
  sheetStatus,
  generating,
  writing = false,
  readOnly,
  onGenerate,
  onRenamed,
  onClose,
  pager,
}: CharacterStudioProps) {
  const { t } = useTranslation(["assets", "dashboard", "common"]);
  const character = asset as Character;
  const Icon = ASSET_TYPE_ICON.character;

  const source = useMemo(() => assetFieldsOf("character", asset), [asset]);
  const save = useCallback(
    async (value: AssetFields, saved: AssetFields) => {
      await updateAssetFields(projectName, "character", name, assetFieldsPatch("character", value, saved));
      await refreshAfterWrite(projectName, t);
      return normalizeAssetFields(value);
    },
    [projectName, name, t],
  );
  const unit = useEditUnit<AssetFields>({
    source,
    save,
    isEqual: assetFieldsEqual,
    leaveTitle: t("assets:edit_leave_title", { name }),
  });
  const { value, setValue } = unit;
  const writes = useAssetWrites();
  useLeaveGuard({ dirty: false, saving: writes.writing || writing, save: unit.save });

  const saving = unit.status === "saving";
  const occupied = useAssetBusyNames("character", projectName).has(name);
  const busy = generating || occupied || saving || writes.writing || writing;

  // 主形象资产图
  const gallery = toGalleryAsset("character", name, character);
  const sheetFp = useProjectsStore((s) => (gallery.sheetPath ? s.getAssetFingerprint(gallery.sheetPath) : null));
  const sheetUrl =
    gallery.sheetPath && sheetStatus?.status !== "missing" ? API.getFileUrl(projectName, gallery.sheetPath, sheetFp) : null;
  const [viewing, setViewing] = useState<{ src: string | null; title: string; alt: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const portraitUrl = sheetUrl && sheetUrl !== failedUrl ? sheetUrl : null;
  const marker = markerOf(gallery, sheetStatus, generating);
  const imageAlt = t("assets:asset_image_alt", { name });

  // 组装后的生成提示词（只读展示）：按当前描述草稿渲染，防抖
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      if (!value.description.trim()) {
        setPromptText(null);
        setPromptError(null);
        return;
      }
      try {
        const result = await API.previewAssetPrompt(projectName, "character", name, value.description, { signal: controller.signal });
        if (result.unavailable) {
          setPromptError(result.unavailable);
          setPromptText(null);
        } else {
          setPromptText(result.text ?? "");
          setPromptError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) setPromptError(errMsg(err));
      }
    };
    const timer = setTimeout(() => {
      void run();
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectName, name, value.description]);

  // 造型（衍生）：复用角色详情的衍生区块，保留行内编辑、保留登记与占用互斥
  const derivatives = character.derivatives ?? {};

  const voiceBinding = useProjectsStore((s) => s.currentProjectData?.character_voice_binding ?? DEFAULT_CHARACTER_VOICE_BINDING);

  const staleConfirm = useStaleRegenerateConfirm({
    projectName,
    assetType: "character",
    name,
    status: sheetStatus,
    hasSheet: Boolean(gallery.sheetPath),
    onGenerate: () => onGenerate(name),
  });

  const generate = () => {
    if (busy || rejectIfAssetBusy("character", projectName, name, t, "assets:gallery_busy_hint")) return;
    // 资产图只由描述与参考图生成：改了描述，保存后这张图就会过期，服务端此刻的判定还看不到
    const willBeStale = value.description !== unit.savedValue.description;
    void unit.saveAndGenerate(() => {
      if (!rejectIfAssetBusy("character", projectName, name, t, "assets:gallery_busy_hint")) return onGenerate(name);
    }, {
      confirm: async () => {
        if (!(await staleConfirm.confirm({ willBeStale }))) return false;
        return !rejectIfAssetBusy("character", projectName, name, t, "assets:gallery_busy_hint");
      },
    });
  };

  const setField = <K extends keyof AssetFields>(key: K, next: AssetFields[K]) =>
    setValue((prev) => ({ ...prev, [key]: next }));
  const generateLabel = unit.dirty
    ? t("common:save_and_generate")
    : gallery.sheetPath
      ? t("dashboard:regenerate_design")
      : t("dashboard:generate_design");
  const describable = hasUsableDescription(value.description);
  const aliases = character.aliases ?? [];
  const mentionToken = `@[${name}]`;

  return (
    <AssetWriteProvider value={writes.track}>
      {/* 顶栏：返回、面包屑、翻页 */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common:close")}>
            <ArrowLeft aria-hidden />
          </Button>
          <nav aria-label={t("assets:details_label", { name })} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{projectName}</span>
            <ChevronRight aria-hidden className="size-3 shrink-0" />
            <span className="shrink-0">{t("dashboard:characters")}</span>
            <ChevronRight aria-hidden className="size-3 shrink-0" />
            <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary">{name}</span>
          </nav>
        </div>
        {pager ? <PagerControl pager={pager} /> : null}
      </header>

      {/* 三栏主体 */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左栏：主形象 */}
        <section className="flex w-[400px] min-w-[340px] shrink-0 flex-col border-r border-border" aria-label={t("assets:studio.master_look")}>
          <ColumnHeader icon={<UserRound aria-hidden className="size-4 text-primary" />} title={t("assets:studio.master_look")} />
          <div className="relative flex-1 space-y-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-border bg-black/40">
              {portraitUrl ? (
                <button
                  type="button"
                  onClick={() => setViewing({ src: portraitUrl, title: name, alt: imageAlt })}
                  aria-label={t("assets:view_image", { name: imageAlt })}
                  className="focus-ring block size-full"
                >
                  <CrossfadeImage
                    src={portraitUrl}
                    alt={imageAlt}
                    className="size-full object-cover"
                    onError={() => setFailedUrl(portraitUrl)}
                    fallback={null}
                  />
                </button>
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Icon aria-hidden className="size-8" />
                  <span className="text-sm">{t("assets:no_sheet")}</span>
                </div>
              )}
              <GalleryStatusMarker marker={marker} className="absolute top-2 left-2" />
              <div className="absolute inset-x-2.5 bottom-2.5 rounded-lg border border-white/10 bg-black/50 p-2 backdrop-blur-sm">
                <div className="truncate text-sm font-semibold text-white">{name}</div>
                <div className="truncate text-xs text-white/70">{t("dashboard:characters")}</div>
              </div>
            </div>

            {readOnly ? null : (
              <div className="flex items-center gap-2">
                <GenerateButton
                  onClick={generate}
                  loading={generating}
                  disabled={!describable || busy}
                  label={generateLabel}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => portraitUrl && setViewing({ src: portraitUrl, title: name, alt: imageAlt })}
                  disabled={!portraitUrl}
                  aria-label={t("assets:gallery_menu_view")}
                >
                  <Eye aria-hidden />
                </Button>
              </div>
            )}
            {readOnly || describable ? null : (
              <p className="text-xs text-muted-foreground">{t("assets:sheet_description_required")}</p>
            )}

            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("assets:original_section")}
              </span>
              <AssetOriginalsField
                projectName={projectName}
                name={name}
                assetType="character"
                paths={character.reference_image ? [character.reference_image] : []}
                readOnly={readOnly}
                busy={busy}
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-primary/50 shadow-sm">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Sparkles aria-hidden className="size-3.5 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("assets:studio.prompt_title")}</span>
                </div>
                {promptText ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {t("assets:studio.prompt_length", { count: promptText.length })}
                  </span>
                ) : null}
              </div>
              <div className="relative max-h-60 overflow-y-auto bg-black/20 p-3 font-mono text-xs leading-relaxed">
                {promptError ? (
                  <span className="text-muted-foreground">{promptError}</span>
                ) : promptText ? (
                  promptText
                ) : (
                  <span className="text-muted-foreground">{t("assets:studio.prompt_empty")}</span>
                )}
              </div>
              {promptText ? (
                <div className="flex justify-end border-t border-border px-3 py-1.5">
                  <CopyButton text={promptText} label={t("assets:studio.prompt_title")} className="size-7" />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* 中栏：角色设定 */}
        <section className="flex min-w-[360px] flex-1 flex-col border-r border-border" aria-label={t("assets:studio.definition")}>
          <ColumnHeader
            icon={<BadgeCheck aria-hidden className="size-4 text-primary" />}
            title={t("assets:studio.definition")}
            hint={t("assets:aliases_hint")}
          />
          <div className="relative flex-1 space-y-5 overflow-y-auto p-5 [scrollbar-gutter:stable]">
            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("assets:field.name")}
              </span>
              <EditableAssetName
                projectName={projectName}
                name={name}
                assetType="character"
                readOnly={readOnly}
                busy={busy}
                onRenamed={onRenamed}
                renderTitle={(hidden) => (
                  <SheetTitle className={cn("min-w-0", hidden && "sr-only")}>{name}</SheetTitle>
                )}
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("assets:aliases_label")}
              </span>
              <AssetAliasesField
                projectName={projectName}
                name={name}
                assetType="character"
                aliases={aliases}
                readOnly={readOnly}
                busy={busy}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("assets:field.description")}
                </span>
                {readOnly ? null : (
                  <PromptPreviewButton
                    title={t("assets:prompt_preview_title", { name })}
                    beforeOpen={unit.save}
                    saveFirst={unit.dirty}
                    disabled={saving}
                    load={(signal) => API.previewAssetPrompt(projectName, "character", name, value.description, { signal })}
                  />
                )}
              </div>
              <Textarea
                value={value.description}
                readOnly={readOnly}
                onChange={(e) => setField("description", e.target.value)}
                rows={5}
                placeholder={t("dashboard:character_desc_placeholder")}
                aria-label={t("assets:field.description")}
                className="resize-none"
              />
              <div className="mt-1 flex items-end justify-between gap-2">
                <p className="text-xs text-muted-foreground">{t("assets:studio.description_note")}</p>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{value.description.length}</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/40 p-4">
              <CharacterVoiceField
                projectName={projectName}
                name={name}
                voiceStyle={value.voiceStyle}
                onVoiceStyleChange={(next) => setField("voiceStyle", next)}
                referenceAudio={character.reference_audio}
                voiceBinding={voiceBinding}
                readOnly={readOnly}
                busy={busy}
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("assets:studio.mention_token")}:</span>
                <code className="rounded bg-primary/15 px-2 py-0.5 font-mono text-xs font-medium text-primary">{mentionToken}</code>
              </div>
              <CopyButton text={mentionToken} label={t("assets:studio.mention_token")} className="size-7" />
            </div>
          </div>
          {readOnly ? null : (
            <div className="shrink-0 px-4 pb-4 pt-1">
              <UnsavedChangesBar unit={unit} />
            </div>
          )}
        </section>

        {/* 右栏：造型（衍生） */}
        <section className="flex min-w-[420px] flex-1 flex-col" aria-label={t("assets:derivatives")}>
          <ColumnHeader
            icon={<Shirt aria-hidden className="size-4 text-primary" />}
            title={t("assets:derivatives")}
            hint={t("assets:studio.forms_subtitle")}
          />
          <div className="relative flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]">
            <CharacterDerivativesField
              projectName={projectName}
              characterName={name}
              derivatives={derivatives}
              ownerSheet={character.character_sheet}
              readOnly={readOnly}
              busy={busy}
            />
          </div>
        </section>
      </main>

      <AssetImageDialog
        src={viewing?.src ?? null}
        title={viewing?.title ?? ""}
        alt={viewing?.alt ?? ""}
        onClose={() => setViewing(null)}
      />
      {staleConfirm.dialog}
    </AssetWriteProvider>
  );
}

function ColumnHeader({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2 className="truncate text-xs font-semibold uppercase tracking-wider">{title}</h2>
        {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

function PagerControl({ pager }: { pager: StudioPager }) {
  const { t } = useTranslation("assets");
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-border text-xs tabular-nums">
      <button
        type="button"
        onClick={pager.onPrev}
        disabled={!pager.onPrev}
        aria-label={t("editor_previous")}
        className="px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <span className="border-x border-border px-2.5 py-1 font-medium">{t("viewer_position", { index: pager.index, total: pager.total })}</span>
      <button
        type="button"
        onClick={pager.onNext}
        disabled={!pager.onNext}
        aria-label={t("editor_next")}
        className="px-2 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  );
}
