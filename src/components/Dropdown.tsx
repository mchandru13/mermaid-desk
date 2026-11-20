import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDownIcon } from "./Icons";

interface DropdownProps {
  label: ReactNode;
  title?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  testId?: string;
}

export function Dropdown({
  label,
  title,
  align = "left",
  children,
  className = "",
  disabled = false,
  testId,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className={`toolbar-button ${className}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        data-testid={testId}
      >
        {label}
        <ChevronDownIcon size={13} className="dropdown-chevron" />
      </button>
      {open ? (
        <div className={`dropdown-panel ${align === "right" ? "align-right" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  hint,
  checked,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  const checkable = checked !== undefined;
  return (
    <button
      className={`dropdown-item ${checked ? "checked" : ""} ${danger ? "danger" : ""}`}
      role={checkable ? "menuitemcheckbox" : "menuitem"}
      aria-checked={checkable ? checked : undefined}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="dropdown-item-label">
        <span className="dropdown-check">{checked ? "✓" : ""}</span>
        {children}
      </span>
      {hint ? <span className="dropdown-hint">{hint}</span> : null}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="dropdown-separator" role="separator" />;
}
