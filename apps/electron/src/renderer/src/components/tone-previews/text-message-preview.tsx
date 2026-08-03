import { useTranslation } from "react-i18next";

export function TextMessagePreview({
  sample,
}: {
  sample: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1.5 px-4 py-4">
      <p className="text-muted-foreground text-center text-[10px] leading-4">
        {t("tone.personal.preview.time")}
      </p>
      <div className="flex justify-end">
        <div className="max-w-[min(78%,28rem)] rounded-[20px] rounded-br-[7px] bg-sky-600 px-4 py-2.5 text-[14px] leading-[1.45] text-white shadow-sm dark:bg-sky-500">
          {sample}
        </div>
      </div>
    </div>
  );
}
