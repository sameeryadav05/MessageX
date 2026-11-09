# MessageX Launcher

MessageX Launcher starts the complete MessageX infrastructure using Docker.

Developers do not need to clone the GitHub repository or build the broker and dashboard.

## Requirements

- Linux server or cloud VM
- Docker Engine
- Internet access
- Inbound TCP port 15672 allowed in the cloud firewall

## Run MessageX

```bash
docker run -d \
  --name messagex \
  --restart unless-stopped \
  -p 15672:15672 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v messagex_launcher_data:/data \
  sameeryadav2005/messagex:0.1.0