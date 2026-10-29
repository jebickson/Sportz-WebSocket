
import { WebSocket, WebSocketServer } from 'ws';
import { wsArcjet } from '../arcjet.js';
import { readFile, writeFile } from 'node:fs/promises';

const matchSubscribers = new Map();
const dataFile = new URL('../data/data.json', import.meta.url);

// --------------------------------------------------
// MATCH DATA
// --------------------------------------------------

async function loadMatches() {
    const content = await readFile(dataFile, 'utf8');
    const json = JSON.parse(content);

    return Array.isArray(json.matches) ? json.matches : [];
}

async function saveMatches(matches) {
    await writeFile(
        dataFile,
        JSON.stringify({ matches }, null, 2),
        'utf8'
    );
}

// --------------------------------------------------
// SUBSCRIPTIONS
// --------------------------------------------------

function subscribe(matchId, socket) {
    if (!matchSubscribers.has(matchId)) {
        matchSubscribers.set(matchId, new Set());
    }

    matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
    const subscribers = matchSubscribers.get(matchId);

    if (!subscribers) return;

    subscribers.delete(socket);

    if (subscribers.size === 0) {
        matchSubscribers.delete(matchId);
    }
}

function cleanupSubscriptions(socket) {
    for (const matchId of socket.subscriptions) {
        unsubscribe(matchId, socket);
    }

    socket.subscriptions.clear();
}

// --------------------------------------------------
// SEND AND BROADCAST
// --------------------------------------------------

function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
    for (const client of wss.clients) {
        sendJson(client, payload);
    }
}

function broadcastToMatch(matchId, payload) {
    const subscribers = matchSubscribers.get(matchId);

    if (!subscribers) return;

    for (const client of subscribers) {
        sendJson(client, payload);
    }
}

// --------------------------------------------------
// HANDLE CLIENT MESSAGES
// --------------------------------------------------

async function handleMessage(socket, rawData) {
    let message;

    try {
        message = JSON.parse(rawData.toString());
    } catch {
        sendJson(socket, {
            type: 'error',
            message: 'Invalid JSON'
        });
        return;
    }

    try {
        // Return all matches from data.json
        if (message.type === 'get_matches') {
            const matches = await loadMatches();

            sendJson(socket, {
                type: 'matches',
                data: matches
            });
            return;
        }

        // Subscribe to a match
        if (
            message.type === 'subscribe' &&
            Number.isInteger(message.matchId)
        ) {
            const matches = await loadMatches();
            const match = matches.find(
                item => item.id === message.matchId
            );

            if (!match) {
                sendJson(socket, {
                    type: 'error',
                    message: `Match ${message.matchId} not found`
                });
                return;
            }

            subscribe(message.matchId, socket);
            socket.subscriptions.add(message.matchId);

            sendJson(socket, {
                type: 'subscribed',
                matchId: message.matchId
            });

            sendJson(socket, {
                type: 'match_data',
                data: match
            });
            return;
        }

        // Unsubscribe
        if (
            message.type === 'unsubscribe' &&
            Number.isInteger(message.matchId)
        ) {
            unsubscribe(message.matchId, socket);
            socket.subscriptions.delete(message.matchId);

            sendJson(socket, {
                type: 'unsubscribed',
                matchId: message.matchId
            });
            return;
        }

        // Manually set a score for development testing
        if (message.type === 'update_score') {
            const { matchId, homeScore, awayScore } = message;

            if (
                !Number.isInteger(matchId) ||
                !Number.isInteger(homeScore) ||
                !Number.isInteger(awayScore) ||
                homeScore < 0 ||
                awayScore < 0
            ) {
                sendJson(socket, {
                    type: 'error',
                    message: 'Invalid match ID or score'
                });
                return;
            }

            const matches = await loadMatches();
            const match = matches.find(
                item => item.id === matchId
            );

            if (!match) {
                sendJson(socket, {
                    type: 'error',
                    message: `Match ${matchId} not found`
                });
                return;
            }

            match.homeScore = homeScore;
            match.awayScore = awayScore;

            await saveMatches(matches);

            broadcastToMatch(matchId, {
                type: 'score_update',
                data: match
            });

            sendJson(socket, {
                type: 'update_saved',
                matchId,
                homeScore,
                awayScore
            });

            console.log(
                `[SCORE] ${match.homeTeam} ${homeScore} - ` +
                `${awayScore} ${match.awayTeam}`
            );
            return;
        }

        sendJson(socket, {
            type: 'error',
            message: 'Unknown message type'
        });
    } catch (error) {
        console.error('WebSocket request error:', error);

        sendJson(socket, {
            type: 'error',
            message: 'Unable to process request'
        });
    }
}

// --------------------------------------------------
// ATTACH WEBSOCKET SERVER
// --------------------------------------------------

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({
        noServer: true,
        path: '/ws',
        maxPayload: 1024 * 1024
    });

    // HTTP-to-WebSocket upgrade
    server.on('upgrade', async (req, socket, head) => {
        let pathname;

        try {
            pathname = new URL(
                req.url,
                `http://${req.headers.host}`
            ).pathname;
        } catch {
            socket.destroy();
            return;
        }

        if (pathname !== '/ws') {
            socket.destroy();
            return;
        }

        // Arcjet protection
        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);

                if (decision.isDenied()) {
                    const status = decision.reason.isRateLimit()
                        ? '429 Too Many Requests'
                        : '403 Forbidden';

                    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
                    socket.destroy();
                    return;
                }
            } catch (error) {
                console.error(
                    'WebSocket protection error:',
                    error.message
                );

                socket.write(
                    'HTTP/1.1 500 Internal Server Error\r\n\r\n'
                );
                socket.destroy();
                return;
            }
        }

        if (socket.destroyed) return;

        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, req);
        });
    });

    // Client connection
    wss.on('connection', socket => {
        socket.isAlive = true;
        socket.subscriptions = new Set();

        socket.on('pong', () => {
            socket.isAlive = true;
        });

        sendJson(socket, {
            type: 'welcome'
        });

        socket.on('message', data => {
            void handleMessage(socket, data);
        });

        socket.on('error', error => {
            console.error('WebSocket error:', error.message);
        });

        socket.on('close', () => {
            cleanupSubscriptions(socket);
        });
    });

    // --------------------------------------------------
    // HEARTBEAT
    // --------------------------------------------------

    const heartbeatInterval = setInterval(() => {
        for (const socket of wss.clients) {
            if (socket.isAlive === false) {
                socket.terminate();
                continue;
            }

            socket.isAlive = false;
            socket.ping();
        }
    }, 30000);

    // --------------------------------------------------
    // SIMULATED COMMENTARY
    // --------------------------------------------------

    const commentaryLines = [
        'A dangerous attack is building!',
        'A great move down the wing!',
        'An excellent save by the goalkeeper!',
        'A brilliant defensive effort!',
        'A powerful shot goes just wide!',
        'A fantastic move through midfield!',
        'The team wins possession!',
        'A chance to score from close range!',
        'A quick counterattack develops!'
    ];

    let commentaryBusy = false;

    const commentaryInterval = setInterval(async () => {
        if (commentaryBusy || wss.clients.size === 0) return;

        commentaryBusy = true;

        try {
            const matches = await loadMatches();

            if (matches.length === 0) return;

            const match = matches[
                Math.floor(Math.random() * matches.length)
            ];

            const text = commentaryLines[
                Math.floor(Math.random() * commentaryLines.length)
            ];

            const comment = {
                matchId: match.id,
                text,
                timestamp: new Date().toISOString()
            };

            console.log(
                `[Match ${match.id}] ${text} ` +
                `(${match.homeTeam} vs ${match.awayTeam})`
            );

            broadcastToMatch(match.id, {
                type: 'commentary',
                data: comment
            });
        } catch (error) {
            console.error('Commentary error:', error.message);
        } finally {
            commentaryBusy = false;
        }
    }, 500);

    // --------------------------------------------------
    // SIMULATED SCORE UPDATES
    // --------------------------------------------------

    let scoreBusy = false;

    const scoreInterval = setInterval(async () => {
        if (scoreBusy || wss.clients.size === 0) return;

        scoreBusy = true;

        try {
            const matches = await loadMatches();

            if (matches.length === 0) return;

            const match = matches[
                Math.floor(Math.random() * matches.length)
            ];

            if (Math.random() < 0.5) {
                match.homeScore = Number(match.homeScore || 0) + 1;
            } else {
                match.awayScore = Number(match.awayScore || 0) + 1;
            }

            await saveMatches(matches);

            broadcastToMatch(match.id, {
                type: 'score_update',
                data: match
            });

            console.log(
                `[LIVE SCORE] ${match.homeTeam} ${match.homeScore} - ` +
                `${match.awayScore} ${match.awayTeam}`
            );
        } catch (error) {
            console.error('Score simulator error:', error.message);
        } finally {
            scoreBusy = false;
        }
    }, 10000);

    // --------------------------------------------------
    // CLEANUP TIMERS
    // --------------------------------------------------

    wss.on('close', () => {
        clearInterval(heartbeatInterval);
        clearInterval(commentaryInterval);
        clearInterval(scoreInterval);
    });

    // --------------------------------------------------
    // EXISTING BROADCAST API
    // --------------------------------------------------

    function broadcastMatchCreated(match) {
        broadcastToAll(wss, {
            type: 'match_created',
            data: match
        });
    }

    function broadcastCommentary(matchId, comment) {
        broadcastToMatch(matchId, {
            type: 'commentary',
            data: {
                ...comment,
                matchId
            }
        });
    }

    return {
        broadcastMatchCreated,
        broadcastCommentary
    };
}
