import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function HomeIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 10.2 12 3.5l9 6.7" />
      <path d="M5.5 9.2V20h13V9.2" />
      <path d="M9.8 20v-5.4h4.4V20" />
    </svg>
  );
}

function PartiesIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M3.4 19.2c.6-3 2.9-4.7 5.6-4.7s5 1.7 5.6 4.7" />
      <path d="M16.2 6.2a3 3 0 0 1 0 5.8" />
      <path d="M17.6 14.9c2 .6 3.3 2.1 3.7 4.3" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.2" />
      <path d="M8 15.5V11" />
      <path d="M12 15.5V8.5" />
      <path d="M16 15.5v-3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="2.9" />
      <path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20c.8-3.6 3.6-5.6 7.2-5.6s6.4 2 7.2 5.6" />
    </svg>
  );
}

export function BottomNav() {
  const { user } = useAuth();
  const showSettings = user?.role === "owner" || user?.role === "manager";
  const cls = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " active" : ""}`;

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={cls}>
        <HomeIcon />
        <span>Home</span>
      </NavLink>
      <NavLink to="/parties" className={cls}>
        <PartiesIcon />
        <span>Parties</span>
      </NavLink>
      <NavLink to="/reports" className={cls}>
        <ReportsIcon />
        <span>Reports</span>
      </NavLink>
      {showSettings ? (
        <NavLink to="/settings" className={cls}>
          <SettingsIcon />
          <span>Settings</span>
        </NavLink>
      ) : (
        <NavLink to="/account" className={cls}>
          <AccountIcon />
          <span>Account</span>
        </NavLink>
      )}
    </nav>
  );
}
