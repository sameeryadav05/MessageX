
import { useCallback, useState } from "react";
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
  type BrokerConfig
} from "./services/api";

export default function App() {
  const [broker, setBroker] = useState<BrokerConfig | null>(null);

  const load = useCallback(() => getBasicHealth(), []);
  const q = usePolling(load, 10000);

  function handleLogout() {
    disconnectBroker();
    setBroker(null);
  }

  if (!broker) {
    return (
      <Login
        onConnected={setBroker}
      />
    );
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
