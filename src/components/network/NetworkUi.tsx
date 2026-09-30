import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function NetworkSectionHeading({
  icon: Icon,
  title,
  description,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="network-section-heading">
      <span className="network-icon-tile">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {aside}
    </div>
  );
}

export function NetworkBadge({
  state,
  children,
}: {
  state?: string;
  children: ReactNode;
}) {
  return (
    <span className="network-badge" data-state={state}>
      {children}
    </span>
  );
}
