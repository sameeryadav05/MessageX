
import { useState } from "react";
import {
  Waves,
  Server,
  User,
  Lock,
  ArrowRight,
  Loader2
} from "lucide-react";

import {
  loginToBroker,
  type BrokerConfig
} from "../services/api";

interface LoginProps {
  onConnected: (config: BrokerConfig) => void;
}

export default function Login({ onConnected }: LoginProps) {
  const [hostname, setHostname] = useState("127.0.0.1");
  const [port, setPort] = useState("3000");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!hostname.trim() || !port || !username || !password) {
      setError("Please fill in all connection details.");
      return;
    }

    if (
      !/^\d+$/.test(port) ||
      Number(port) < 1 ||
      Number(port) > 65535
    ) {
      setError("Enter a valid management port.");
      return;
    }

    const config: BrokerConfig = {
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      password
    };

    setLoading(true);

    try {
      await loginToBroker(config);
      onConnected(config);
    } catch (err: any) {
      const status = err?.response?.status;

      if (status === 401) {
        setError("Invalid username or password.");
      } else if (status === 404) {
        setError("Management API endpoint was not found.");
      } else if (err?.code === "ECONNABORTED") {
        setError("Connection timed out. Check the broker address.");
      } else {
        setError(
          "Unable to connect. Check the hostname, port and broker status."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">
            <Waves size={28} />
          </div>

          <div>
            <h1>MessageX</h1>
            <span>MESSAGE BROKER MANAGEMENT</span>
          </div>
        </div>

        <div className="login-heading">
          <h2>Connect to a broker</h2>
          <p>
            Enter your broker connection details to access
            the MessageX management dashboard.
          </p>
        </div>

        <form onSubmit={handleConnect}>
          <label>Broker hostname</label>

          <div className="login-input">
            <Server size={17} />
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="127.0.0.1"
              autoComplete="url"
              required
            />
          </div>

          <label>Management port</label>

          <div className="login-input">
            <span className="port-icon">:</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3000"
              inputMode="numeric"
              required
            />
          </div>

          <div className="login-divider" />

          <label>Username</label>

          <div className="login-input">
            <User size={17} />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Broker username"
              autoComplete="username"
              required
            />
          </div>

          <label>Password</label>

          <div className="login-input">
            <Lock size={17} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            className="login-button"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={17} className="spin" />
                Connecting...
              </>
            ) : (
              <>
                Connect to Broker
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <span className="login-status-dot" />
          MessageX Management Console
          <span>v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
