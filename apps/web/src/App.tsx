import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { AccountPage } from "./pages/AccountPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { OpeningsPage } from "./pages/OpeningsPage";
import { PartiesPage } from "./pages/PartiesPage";
import { PartyDetailPage } from "./pages/PartyDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="app-shell">
        <div className="page muted">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><HomePage /></Protected>} />
      <Route path="/parties" element={<Protected><PartiesPage /></Protected>} />
      <Route path="/parties/:id" element={<Protected><PartyDetailPage /></Protected>} />
      <Route path="/openings" element={<Protected><OpeningsPage /></Protected>} />
      <Route path="/customers" element={<Navigate to="/parties" replace />} />
      <Route path="/reports" element={<Protected><ReportsPage /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/account" element={<Protected><AccountPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
