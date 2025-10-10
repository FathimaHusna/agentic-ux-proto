Systemd deployment (Ubuntu/Debian)

1) Install Node 18+ and Chrome/Chromium
   - sudo apt-get update
   - sudo apt-get install -y chromium || install google-chrome-stable

2) Build the app
   - cd /home/fathimahusna/agentic-ux-proto
   - npm ci
   - npm run build

3) Install the service
   - sudo cp deploy/systemd/agentic-ux.service /etc/systemd/system/agentic-ux.service
   - sudo systemctl daemon-reload
   - sudo systemctl enable --now agentic-ux

4) Check status and logs
   - systemctl status agentic-ux
   - journalctl -u agentic-ux -f

Adjust CHROME_PATH/PUPPETEER_EXECUTABLE_PATH to match your browser binary.

