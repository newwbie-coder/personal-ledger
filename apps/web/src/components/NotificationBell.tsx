import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { api, formatDate } from "../lib/api";

interface Notification {
  notification_id: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    if (user?.role !== "owner") return;
    try {
      const data = await api<{ notifications: Notification[]; unread_count: number }>(
        "/notifications",
      );
      setItems(data.notifications);
      setUnread(data.unread_count);
    } catch {
      /* ignore poll errors */
    }
  }

  useEffect(() => {
    if (user?.role !== "owner") return;
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [user?.role, user?.user_id]);

  if (user?.role !== "owner") return null;

  async function markAll() {
    await api("/notifications/read-all", { method: "POST", body: "{}" });
    await load();
  }

  async function openItem(n: Notification) {
    if (!n.read_at) {
      await api(`/notifications/${n.notification_id}/read`, {
        method: "POST",
        body: "{}",
      });
      await load();
    }
    setOpen(false);
  }

  return (
    <div className="notif-wrap">
      <button
        type="button"
        className="notif-bell"
        aria-label={unread ? `${unread} unread notifications` : "Notifications"}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.2 1.5 5.8 1.5 5.8H5s1.5-1.6 1.5-5.8Z" />
          <path d="M10 18.2a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 ? <span className="notif-dot">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Updates</strong>
            {unread > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void markAll()}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="notif-list">
            {items.length === 0 ? (
              <div className="empty-state" style={{ padding: 16 }}>No notifications yet.</div>
            ) : (
              items.map((n) => {
                const href =
                  n.entity_type === "party" && n.entity_id
                    ? `/parties/${n.entity_id}`
                    : null;
                const inner = (
                  <>
                    <div className="row-title" style={{ fontSize: 14 }}>
                      {n.title}
                      {!n.read_at ? <span className="notif-unread-mark" /> : null}
                    </div>
                    <div className="row-sub">{n.body}</div>
                    <div className="row-sub" style={{ marginTop: 2 }}>
                      {formatDate(n.created_at)}
                    </div>
                  </>
                );
                return href ? (
                  <Link
                    key={n.notification_id}
                    to={href}
                    className={`notif-item${!n.read_at ? " unread" : ""}`}
                    onClick={() => void openItem(n)}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={n.notification_id}
                    type="button"
                    className={`notif-item${!n.read_at ? " unread" : ""}`}
                    onClick={() => void openItem(n)}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
