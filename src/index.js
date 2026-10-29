
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AgentAPI from 'apminsight';
import express from 'express';
import http from 'node:http';

import { matchRouter } from './routes/matches.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';
import { commentaryRouter } from './routes/commentary.js';

AgentAPI.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());

// Serve public/index.html and other frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Optional Arcjet security middleware.
// Enable this only if securityMiddleware() is configured
// for your existing application.
 // app.use(securityMiddleware());

// Existing API routes
app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);

// Keep your existing WebSocket server
const {
    broadcastMatchCreated,
    broadcastCommentary
} = attachWebSocketServer(server);

app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;

// Start HTTP and WebSocket server
server.listen(PORT, HOST, () => {
    const baseUrl =
        HOST === '0.0.0.0'
            ? `http://localhost:${PORT}`
            : `http://${HOST}:${PORT}`;

    console.log(`Server is running on ${baseUrl}`);
    console.log(
        `WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`
    );
});
