# MessageX Launcher

Run a complete self-hosted MessageX installation (broker, dashboard and PostgreSQL) with Docker. No Git clone, domain, Nginx, or TLS setup is required.

## Requirements

- Docker Engine
- Host ports TCP 5678 and HTTP 15672 available
- On a cloud VM, allow inbound TCP 5678 and 15672 in its firewall/security group. Restrict dashboard access to trusted IPs where possible.

## Start

The launcher creates the broker and dashboard containers itself and publishes their ports directly on the Docker host. Do not add `-p` flags to the launcher container: those ports are published by its child containers.

~~~bash
docker run -d \
  --name messagex \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v messagex_launcher_data:/data \
  sameeryadav2005/messagex:VERSION
~~~

Replace VERSION with the published launcher tag. The launcher pulls and runs the broker, dashboard and PostgreSQL images. PostgreSQL and the broker management API remain private inside its Docker network.

## Access

- Dashboard: `http://localhost:15672`
- Broker TCP endpoint: `localhost:5678`

On a server, replace localhost with the server's public IP or a DNS name pointing to it.

## Configure ports and credentials

Host ports and bind addresses can be changed without changing container ports. Set `TCP_PORT` (default 5678), `DASHBOARD_PORT` (default 15672), and optionally `TCP_BIND_ADDRESS` (default 0.0.0.0) as launcher environment variables.

For custom admin credentials on first startup, set both `MESSAGEX_DEFAULT_USER` and `MESSAGEX_DEFAULT_PASS` (password must be at least 12 characters). If omitted, the launcher generates a password and prints it in its logs. Credentials persist in the launcher data volume and are not reset by restarts.

## Useful commands

~~~bash
docker logs -f messagex
docker exec messagex cat /data/credentials.txt
docker stop messagex
docker start messagex
~~~

## Security

The current broker TCP protocol and dashboard HTTP endpoint do not provide TLS encryption. Do not expose them to untrusted networks. Restrict access with cloud firewalls or host firewall rules. PostgreSQL (5432) and the broker management API (3000) are not published to the host.

The launcher mounts the Docker socket to manage its child containers; treat the launcher as a privileged component.
