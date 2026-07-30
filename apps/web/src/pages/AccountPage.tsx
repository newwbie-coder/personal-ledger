import { BottomNav } from "../components/BottomNav";
import { useAuth } from "../auth";

export function AccountPage() {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <div className="page">
        <div className="page-head">
          <div className="eyebrow">Profile</div>
          <h1 className="page-title">Account</h1>
        </div>
        <div className="card-surface">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div className="row-title" style={{ fontSize: 17 }}>{user?.name}</div>
              <div className="row-sub">{user?.username}</div>
            </div>
            <span className="badge badge-accent">{user?.role}</span>
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 14 }} type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
