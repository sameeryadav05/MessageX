
import {
  Activity,
  Boxes,
  Cable,
  GitBranch,
  LayoutDashboard,
  Waves,
  Server,
  LogOut
} from "lucide-react";

import {
  NavLink,
  useLocation
} from "react-router-dom";

const links = [
  ["/", "Overview", LayoutDashboard],
  ["/queues", "Queues", Boxes],
  ["/exchanges", "Exchanges", GitBranch],
  ["/connections", "Connections", Cable],
  ["/monitoring", "Monitoring", Activity]
] as const;

interface LayoutProps {
  children: React.ReactNode;
  refresh: () => void;
  updated: Date | null;
  brokerAddress: string;
  username: string;
  onLogout: () => void;
}

export default function Layout({
  children,
  refresh,
  updated,
  brokerAddress,
  username,
  onLogout
}: LayoutProps) {
  const loc = useLocation();

  const title =
    links.find((x) => x[0] === loc.pathname)?.[1] ?? "Overview";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span><Waves /></span>
          <div>
            <b>MessageX</b>
            <small>MESSAGE BROKER</small>
          </div>
        </div>

        <label>BROKER</label>

        <nav>
          {links.map(([to, name, Icon]) => (
            <NavLink
              end={to === "/"}
              to={to}
              key={to}
            >
              <Icon size={18} />
              {name}
              {to === "/" && <i className="navdot" />}
            </NavLink>
          ))}
        </nav>

        <div className="side-bottom">
          <label>INSTANCE</label>

          <div className="instance">
            <Server size={17} />
            <div>
              <b>{username}</b>
              <small>{brokerAddress}</small>
            </div>
            <i />
          </div>

          <small>MessageX Management · v1.0.0</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <small>MessageX　/　{title}</small>
            <h1>{title}</h1>
          </div>

          <div className="top-actions">
            <small>
              Updated {updated?.toLocaleTimeString() ?? "—"}
            </small>

            <button onClick={refresh} title="Refresh">
              ↻
            </button>

            <button
              onClick={onLogout}
              title="Disconnect from broker"
              className="logout-button"
            >
              <LogOut size={16} />
            </button>

            <span>MX</span>
          </div>
        </header>

        <div className="content">
          <div className="api-banner">
            <i />
            Connected to {brokerAddress}
            <small>Authenticated as {username}</small>
          </div>

          {children}

          <footer>
            MessageX Broker Management · Self-hosted messaging platform
          </footer>
        </div>
      </main>
    </div>
  );
}
