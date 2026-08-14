import { useFirm } from "../firm";

export function FirmSelector() {
  const { firms, selectedFirmId, setSelectedFirmId, selectedFirm, isSummary, firmLocked } =
    useFirm();

  if (firmLocked) {
    return (
      <div className="firm-bar">
        <div className="firm-bar-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.5 20.5h17" />
            <path d="M5.5 20.5V6.2l6-2.7 6 2.7v14.3" />
            <path d="M9.3 10.4h1.4M13.3 10.4h1.4M9.3 14.2h1.4M13.3 14.2h1.4" />
          </svg>
        </div>
        <div className="firm-bar-body">
          <div className="firm-bar-label">Your firm</div>
          <div className="firm-bar-name">
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedFirm?.firm_name ?? "Firm"}
            </span>
            <span className="badge badge-muted">Locked</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="firm-bar">
      <div className="firm-bar-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 20.5h17" />
          <path d="M5.5 20.5V6.2l6-2.7 6 2.7v14.3" />
          <path d="M9.3 10.4h1.4M13.3 10.4h1.4M9.3 14.2h1.4M13.3 14.2h1.4" />
        </svg>
      </div>
      <div className="firm-bar-body">
        <div className="firm-bar-label">Current firm</div>
        <div className="firm-bar-name">
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {isSummary ? "All firms" : selectedFirm?.firm_name ?? "Firm"}
          </span>
          {isSummary ? <span className="badge badge-muted">Company total</span> : null}
        </div>
      </div>
      <select
        className="firm-select"
        aria-label="Switch firm"
        value={selectedFirmId ?? "summary"}
        onChange={(e) =>
          setSelectedFirmId(e.target.value === "summary" ? null : e.target.value)
        }
      >
        <option value="summary">All firms (total)</option>
        {firms.map((f) => (
          <option key={f.firm_id} value={f.firm_id}>
            {f.firm_name}
          </option>
        ))}
      </select>
    </div>
  );
}
