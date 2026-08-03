// A single "what lands" example for a cleanup level.
export function CleanupPreview({
  result,
}: {
  result: string;
}): React.JSX.Element {
  return (
    <div className="rounded-[14px] border border-border/70 bg-background/60 px-3.5 py-3">
      <p className="text-foreground text-[13px] leading-[1.5]">{result}</p>
    </div>
  );
}
