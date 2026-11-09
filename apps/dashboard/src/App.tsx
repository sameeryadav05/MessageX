import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes
} from "react-router-dom";

import Layout from "./components/Layout";
import Overview from "./pages/Overview";
import Queues from "./pages/Queues";
import Exchanges from "./pages/Exchanges";
import Connections from "./pages/Connections";
import Monitoring from "./pages/Monitoring";
import Login from "./pages/Login";

import { usePolling } from "./hooks/usePolling";
import {
  disconnectBroker,
  getBasicHealth,
  loginToBroker,
  logoutFromBroker,
  restoreBrokerSession,
  type BrokerConfig
} from "./services/api";

export default function App() {
  const [broker, setBroker] = useState<BrokerConfig | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;

    void restoreBrokerSession()
      .then((session) => {
        if (active && session) setBroker(session);
      })
      .catch((error) => {
        console.error("[Dashboard] Session restoration failed:", error);
        disconnectBroker();
      })
      .finally(() => {
        if (active) setRestoring(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(() => getBasicHealth(), []);
  const q = usePolling(load, 10000);

  async function handleLogout() {
    try {
      await logoutFromBroker();
    } catch (error) {
      console.error("[Dashboard] Logout request failed:", error);
      disconnectBroker();
    } finally {
      setBroker(null);
    }
  }

  async function handleConnected(config: BrokerConfig) {
    // loginToBroker has already configured the API client and established
    // either a browser session or a legacy cross-origin Basic connection.
    await loginToBroker(config);
    setBroker(config);
  }

  if (restoring) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-logo">MX</div>
            <div>
              <h1>MessageX</h1>
              <span>RESTORING SESSION</span>
            </div>
          </div>
          <p>Checking your existing dashboard session...</p>
        </div>
      </div>
    );
  }

  if (!broker) {
    return <Login onConnected={handleConnected} />;
  }

  return (
    <Layout
      refresh={() => void q.refresh()}
      updated={q.updatedAt}
      brokerAddress={`${broker.hostname}:${broker.port}`}
      username={broker.username}
      onLogout={handleLogout}
    >
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/queues" element={<Queues />} />
        <Route path="/exchanges" element={<Exchanges />} />
        <Route path="/connections" element={<Connections />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
