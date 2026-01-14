import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Whop from '@whop/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Whop SDK with API key and App ID (note: appID not appId)
const whopClient = new Whop({
    apiKey: process.env.WHOP_API_KEY || '',
    appID: process.env.WHOP_APP_ID || ''  // Changed from appId to appID
});

console.log('[SERVER] Whop client initialized');
console.log('[SERVER] WHOP_API_KEY:', process.env.WHOP_API_KEY ? 'SET' : 'NOT SET');
console.log('[SERVER] WHOP_APP_ID:', process.env.WHOP_APP_ID ? 'SET' : 'NOT SET');

// Serve static files from dist
app.use(express.static(join(__dirname, 'dist')));

// API endpoint to get current Whop user - reads headers automatically set by Whop proxy
app.get('/api/whop/me', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    console.log('[SERVER] /api/whop/me called');
    console.log('[SERVER] x-whop-user-token:', userToken ? `PRESENT (${String(userToken).substring(0, 30)}...)` : 'MISSING');

    if (!userToken) {
        return res.json({
            authenticated: false,
            error: 'No x-whop-user-token header - not accessed through Whop'
        });
    }

    try {
        // Create a Headers object that the SDK expects
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));

        // Verify the token
        console.log('[SERVER] Calling verifyUserToken...');
        const verification = await whopClient.verifyUserToken(headers);

        const userId = verification.userId;
        console.log('[SERVER] Verified userId:', userId);

        // Retrieve full user profile using the extracted userId
        const user = await whopClient.users.retrieve(userId);
        console.log('[SERVER] User retrieved:', user.name, user.username);

        // Get experience ID from the URL path
        const referer = req.headers['referer'] || req.headers['x-whop-experience-id'] || '';
        const expMatch = String(referer).match(/experiences\/(exp_[A-Za-z0-9]+)/);
        const experienceId = expMatch ? expMatch[1] : null;

        // Check access to the experience
        let access = { has_access: true, access_level: 'customer' };
        if (experienceId) {
            console.log('[SERVER] Checking access for experience:', experienceId);
            try {
                access = await whopClient.users.checkAccess(experienceId, { id: userId });
                console.log('[SERVER] Access result:', access);
            } catch (e) {
                console.log('[SERVER] Access check failed, defaulting to customer:', e.message);
            }
        }

        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                name: user.name || user.username,
                profile_picture: user.profile_picture?.url
            },
            access,
            experienceId
        });
    } catch (error) {
        console.error('[SERVER] Auth error:', error.message);
        console.error('[SERVER] Full error:', error);
        res.status(500).json({
            authenticated: false,
            error: error.message
        });
    }
});

// Debug endpoint to see all headers
app.get('/api/debug/headers', (req, res) => {
    console.log('[SERVER] Debug - All headers:', JSON.stringify(req.headers, null, 2));
    res.json({ headers: req.headers });
});

// Fallback to index.html for SPA routing
app.get('/{*path}', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Nova running on port ${PORT}`);
});
