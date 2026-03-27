// ============================================================
// server.js — Express uptime server for Glitch.com
// Keeps the bot alive by responding to health-check pings
// ============================================================

const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check root
app.get('/', (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Student Prompt Hub AI — Bot Status</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #0f0f1a;
          color: #e2e8f0;
          font-family: 'Segoe UI', system-ui, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .card {
          background: #1a1a2e;
          border: 1px solid #2d2d5e;
          border-radius: 16px;
          padding: 40px 48px;
          text-align: center;
          max-width: 480px;
        }
        .pulse {
          display: inline-block;
          width: 14px; height: 14px;
          background: #22c55e;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
        h1 { font-size: 1.6rem; margin-bottom: 8px; color: #a78bfa; }
        p { color: #94a3b8; margin-top: 12px; font-size: 0.95rem; }
        .status { font-size: 1.1rem; font-weight: 600; color: #22c55e; }
        .badge {
          display: inline-block;
          background: #22c55e22;
          color: #22c55e;
          border: 1px solid #22c55e44;
          border-radius: 999px;
          padding: 4px 16px;
          font-size: 0.8rem;
          margin-top: 20px;
          letter-spacing: 0.05em;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div>
          <span class="pulse"></span>
          <span class="status">ONLINE</span>
        </div>
        <h1>🎓 Student Prompt Hub AI</h1>
        <p>Built by <strong>Propeak Digital Academy</strong></p>
        <p>Founder: <strong>Peculiar</strong></p>
        <p style="margin-top:20px;">Bot is running and ready to serve students 24/7.</p>
        <div class="badge">⏱ Uptime: Active</div>
        <p style="margin-top:20px; font-size:0.8rem; color:#64748b;">
          Last check: ${new Date().toUTCString()}
        </p>
      </div>
    </body>
    </html>
  `);
});

// Simple JSON status endpoint for ping services
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', bot: 'Student Prompt Hub AI', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[Server] Express uptime server running on port ${PORT}`);
});

module.exports = app;
  
