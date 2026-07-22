"use client";

export type FeedbackKind = "success" | "error" | "warning" | "info";

export function Feedback({
  kind,
  title,
  children,
}: {
  kind: FeedbackKind;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`feedback feedback-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}
