import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Whop from '@whop/sdk';
import { connectDB, User, Analysis, Conversation } from './server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Use 3001 for backend to avoid conflict with Vite (3000)
const PORT = process.env.PORT || 3001;

// Parse JSON bodies
app.use(express.json());

// Initialize Whop SDK with API key and App ID
const whopClient = new Whop({
    apiKey: process.env.WHOP_API_KEY || '',
    appID: process.env.WHOP_APP_ID || '',
    webhookKey: process.env.WHOP_WEBHOOK_SECRET ? Buffer.from(process.env.WHOP_WEBHOOK_SECRET).toString('base64') : undefined
});

// Connect to Database
connectDB();

console.log('[SERVER] Whop client initialized');

// Serve static files from dist
app.use(express.static(join(__dirname, 'dist')));

// API endpoint to get current Whop user and sync with DB
app.get('/api/whop/me', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.json({
            authenticated: false,
            error: 'No x-whop-user-token header'
        });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));

        // Verify the token
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        // Retrieve full user profile
        const whopUser = await whopClient.users.retrieve(userId);

        // Sync with MongoDB
        let dbUser = await User.findOne({ whopUserId: userId });

        if (!dbUser) {
            console.log(`[DB] Creating new user: ${whopUser.username}`);
            dbUser = await User.create({
                whopUserId: userId,
                username: whopUser.username,
                credits: 10, // Increased free credits for new users
                isPro: false
            });
        } else {
            // Update last login
            dbUser.lastLogin = new Date();
            await dbUser.save();
        }

        // Get experience ID from multiple sources for the response
        const referer = req.headers['referer'] || '';
        const expHeader = req.headers['x-whop-experience-id'] || '';
        const expMatch = String(referer).match(/experiences\/(exp_[A-Za-z0-9]+)/);
        const experienceId = expMatch ? expMatch[1] : (expHeader || process.env.WHOP_EXPERIENCE_ID || null);

        // --- PRO SYNC: Check for specific paid plan membership ---
        const planId = process.env.WHOP_PLAN_ID;
        const companyId = process.env.WHOP_COMPANY_ID;

        console.log(`[SYNC] Starting sync for ${whopUser.username} (${userId})`);
        console.log(`[SYNC] Config: PlanID=${planId || 'MISSING'}, CompanyID=${companyId || 'MISSING'}`);

        let access = { has_access: true, access_level: 'customer' };
        let hasProAccess = false;

        // 1. Broad access check (to experience) and team member identification
        if (experienceId) {
            try {
                console.log(`[SYNC] Checking broad access to experience: ${experienceId}`);
                const accRes = await whopClient.users.checkAccess(experienceId, { id: userId });
                access = { has_access: accRes.has_access, access_level: accRes.access_level };

                // Admins/Team members are default Pro
                if (accRes.access_level === 'admin') {
                    hasProAccess = true;
                    console.log(`[SYNC] Identified as Admin/Team Member - granting Pro status.`);
                }
            } catch (e) {
                console.log('[SYNC] broad check error (non-fatal):', e.message);
                access = { has_access: true, access_level: 'customer' };
            }
        }

        // 2. Specific Plan Membership Check (if not already Pro via Team check)
        if (!hasProAccess && planId && companyId) {
            try {
                console.log(`[SYNC] Checking memberships for plan: ${planId} (Company: ${companyId})`);
                const membershipIterator = whopClient.memberships.list({
                    company_id: companyId,
                    user_ids: [userId],
                    plan_ids: [planId],
                    statuses: ['active', 'trialing'], // 'completed' removed to ensure only active subs count
                    first: 1
                });

                // Check if there's at least one active membership
                for await (const membership of membershipIterator) {
                    console.log(`[SYNC] VALID: Found ${membership.status} membership (ID: ${membership.id})`);
                    hasProAccess = true;
                    break; // One is enough
                }

                if (!hasProAccess) {
                    console.log(`[SYNC] No active/trialing memberships found for the Pro plan.`);
                }
            } catch (membershipError) {
                console.log(`[SYNC] Membership check error: ${membershipError.message}`);

                // Fallback: If SDK method fails, try raw API call with company key
                if (companyId && process.env.WHOP_API_KEY) {
                    try {
                        console.log(`[SYNC] Fallback: Trying raw API...`);
                        const mUrl = new URL('https://api.whop.com/api/v1/memberships');
                        mUrl.searchParams.append('user_ids[]', userId);
                        mUrl.searchParams.append('plan_ids[]', planId);
                        mUrl.searchParams.append('statuses[]', 'active');
                        mUrl.searchParams.append('statuses[]', 'trialing');
                        mUrl.searchParams.append('company_id', companyId);

                        const mRes = await fetch(mUrl, {
                            headers: { 'Authorization': `Bearer ${process.env.WHOP_API_KEY}`, 'Accept': 'application/json' }
                        });

                        if (mRes.ok) {
                            const mData = await mRes.json();
                            if ((mData.data || []).length > 0) {
                                console.log(`[SYNC] Fallback SUCCESS: Found active membership.`);
                                hasProAccess = true;
                            }
                        }
                    } catch (fallbackError) {
                        console.log(`[SYNC] Fallback catch: ${fallbackError.message}`);
                    }
                }
            }
        }

        // 3. FINAL DATABASE SYNC
        try {
            if (hasProAccess) {
                if (!dbUser.isPro) {
                    console.log(`[DB] Upgrading ${whopUser.username} to Pro.`);
                    dbUser.isPro = true;
                    await dbUser.save();
                } else {
                    console.log(`[DB] ${whopUser.username} verified as Pro.`);
                }
            } else {
                // If user was Pro before but no longer has access, downgrade them
                if (dbUser.isPro) {
                    console.log(`[DB] User ${whopUser.username} NO LONGER has Pro access. Downgrading in DB.`);
                    dbUser.isPro = false;
                    await dbUser.save();
                } else {
                    console.log(`[DB] ${whopUser.username} remains on Free plan.`);
                }
            }
        } catch (dbErr) {
            console.error(`[DB] Fatal sync error:`, dbErr);
        }
        console.log(`[SYNC] --- END ---`);

        res.json({
            authenticated: true,
            user: {
                id: whopUser.id,
                username: whopUser.username,
                name: whopUser.name || whopUser.username,
                profile_picture: whopUser.profile_picture?.url,
                credits: dbUser.credits,
                isPro: dbUser.isPro
            },
            access,
            experienceId
        });
    } catch (error) {
        console.error('[SERVER] Auth error:', error.message);
        res.status(500).json({
            authenticated: false,
            error: error.message
        });
    }
});

// Endpoint to deduct credits
app.post('/api/credits/deduct', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Verify User again to be safe
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const user = await User.findOne({ whopUserId: userId });

        if (!user) {
            return res.status(404).json({ error: 'User not found in database' });
        }

        if (user.isPro) {
            return res.json({ success: true, remaining: 'UNLIMITED', isPro: true });
        }

        if (user.credits > 0) {
            user.credits -= 1;
            await user.save();
            console.log(`[DB] Deducted credit for ${user.username}. Remaining: ${user.credits}`);
            return res.json({ success: true, remaining: user.credits, isPro: false });
        } else {
            return res.status(403).json({ error: 'Insufficient credits', remaining: 0, isPro: false });
        }

    } catch (error) {
        console.error('[SERVER] Credit deduction error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to save analysis history
app.post('/api/analysis/save', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];
    const { symbol, price, verdict, technicals, thought_process } = req.body;

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const analysis = await Analysis.create({
            whopUserId: userId,
            symbol,
            price,
            verdict,
            technicals,
            thought_process
        });

        res.json({ success: true, analysisId: analysis._id });
    } catch (error) {
        console.error('[SERVER] Analysis save error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch analysis history
app.get('/api/analysis/history', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const history = await Analysis.find({ whopUserId: userId }).sort({ createdAt: -1 }).limit(50);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[SERVER] Analysis history fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to save chat messages
app.post('/api/chat/save', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];
    const { message, conversationId } = req.body; // message: { role, content }

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        let conversation;
        if (conversationId) {
            conversation = await Conversation.findOne({ _id: conversationId, whopUserId: userId });
        }

        if (!conversation) {
            // Create new conversation
            conversation = await Conversation.create({
                whopUserId: userId,
                title: message.content.slice(0, 50) + (message.content.length > 50 ? '...' : ''),
                messages: [message],
                lastMessageAt: new Date()
            });
        } else {
            // Append to existing
            conversation.messages.push(message);
            conversation.lastMessageAt = new Date();
            await conversation.save();
        }

        res.json({ success: true, conversationId: conversation._id });
    } catch (error) {
        console.error('[SERVER] Chat save error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to fetch chat history
app.get('/api/chat/history', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        // Verify if user is Pro in DB
        const dbUser = await User.findOne({ whopUserId: userId });
        if (!dbUser?.isPro) {
            return res.status(403).json({ error: 'Premium subscription required for history.' });
        }

        const history = await Conversation.find({ whopUserId: userId }).sort({ lastMessageAt: -1 }).limit(20);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[SERVER] Chat history fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to create a checkout session
app.post('/api/checkout/session', async (req, res) => {
    const userToken = req.headers['x-whop-user-token'];

    if (!userToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const headers = new Headers();
        headers.set('x-whop-user-token', String(userToken));
        const verification = await whopClient.verifyUserToken(headers);
        const userId = verification.userId;

        const planId = process.env.WHOP_PLAN_ID;
        if (!planId) {
            return res.status(400).json({
                error: 'Configuration Error: WHOP_PLAN_ID is missing in environment variables. Please add it to Render.'
            });
        }

        // Create a checkout configuration using a pre-defined Plan ID
        const checkoutConfig = await whopClient.checkoutConfigurations.create({
            plan_id: planId,
            metadata: {
                whop_user_id: userId,
                source: 'nova_app_upgrade_button'
            }
        });

        res.json({ success: true, sessionId: checkoutConfig.id });
    } catch (error) {
        console.error('[SERVER] Checkout session error:', error);
        res.status(500).json({
            error: 'Failed to initialize checkout. Please ensure WHOP_PLAN_ID and WHOP_COMPANY_ID are correct.',
            details: error.message
        });
    }
});

app.get('/api/debug/headers', (req, res) => {
    res.json({ headers: req.headers });
});

// Webhook endpoint for Whop membership events
// Note: This needs raw body for signature verification, so we use a separate route with express.raw()
app.post('/api/webhooks/whop', express.raw({ type: 'application/json' }), async (req, res) => {
    console.log('[WEBHOOK] Received webhook request');

    try {
        // Get raw body as text for signature verification
        const rawBody = req.body.toString('utf8');
        const webhookHeaders = {
            'webhook-signature': req.headers['webhook-signature'],
            'webhook-timestamp': req.headers['webhook-timestamp'],
            'webhook-id': req.headers['webhook-id']
        };

        console.log('[WEBHOOK] Headers:', JSON.stringify(webhookHeaders));

        // Parse the webhook payload
        let webhookData;
        try {
            // If WHOP_WEBHOOK_SECRET is set, validate signature using SDK
            const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;
            if (webhookSecret && whopClient.webhooks) {
                webhookData = whopClient.webhooks.unwrap(rawBody, { headers: req.headers });
            } else {
                // Fallback: parse directly (for testing without signature validation)
                webhookData = JSON.parse(rawBody);
                console.log('[WEBHOOK] WARNING: Webhook secret not configured, skipping signature validation');
            }
        } catch (parseError) {
            console.error('[WEBHOOK] Failed to parse/validate webhook:', parseError.message);
            return res.status(400).json({ error: 'Invalid webhook payload' });
        }

        console.log('[WEBHOOK] Event type:', webhookData.type);
        console.log('[WEBHOOK] Event data:', JSON.stringify(webhookData.data, null, 2));

        // Handle membership.activated event
        if (webhookData.type === 'membership.activated') {
            const membership = webhookData.data;
            const userId = membership.user?.id;
            const planId = membership.plan?.id;
            const targetPlanId = process.env.WHOP_PLAN_ID;

            console.log(`[WEBHOOK] membership.activated - User: ${userId}, Plan: ${planId}, Target: ${targetPlanId}`);

            if (userId) {
                // Check if this is for our target plan (or accept all if no target set)
                if (!targetPlanId || planId === targetPlanId) {
                    const user = await User.findOne({ whopUserId: userId });

                    if (user) {
                        if (!user.isPro) {
                            user.isPro = true;
                            await user.save();
                            console.log(`[WEBHOOK] SUCCESS: Upgraded user ${user.username} to Pro`);
                        } else {
                            console.log(`[WEBHOOK] User ${user.username} is already Pro`);
                        }
                    } else {
                        // User doesn't exist in DB yet, create them as Pro
                        console.log(`[WEBHOOK] User ${userId} not found in DB, creating as Pro`);
                        await User.create({
                            whopUserId: userId,
                            username: membership.user?.username || 'unknown',
                            credits: 10,
                            isPro: true
                        });
                        console.log(`[WEBHOOK] SUCCESS: Created new Pro user ${userId}`);
                    }
                } else {
                    console.log(`[WEBHOOK] Ignoring membership for different plan: ${planId}`);
                }
            }
        }

        // Handle membership.deactivated event
        if (webhookData.type === 'membership.deactivated') {
            const membership = webhookData.data;
            const userId = membership.user?.id;

            console.log(`[WEBHOOK] membership.deactivated - User: ${userId}`);

            if (userId) {
                const user = await User.findOne({ whopUserId: userId });

                if (user && user.isPro) {
                    user.isPro = false;
                    await user.save();
                    console.log(`[WEBHOOK] User ${user.username} downgraded from Pro`);
                }
            }
        }

        // Handle payment.succeeded event (backup for immediate feedback)
        if (webhookData.type === 'payment.succeeded') {
            console.log(`[WEBHOOK] payment.succeeded received`);
            // The membership.activated event will handle the actual upgrade
        }

        // Always return 200 quickly to prevent Whop from retrying
        res.status(200).json({ received: true });

    } catch (error) {
        console.error('[WEBHOOK] Error processing webhook:', error);
        // Still return 200 to prevent retries for handling errors
        res.status(200).json({ received: true, error: 'Processing error' });
    }
});

app.get('/{*path}', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Nova running on port ${PORT}`);
});
