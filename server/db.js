import mongoose from 'mongoose';

// Connect to MongoDB
export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`[MONGODB] Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[MONGODB] Error: ${error.message}`);
        process.exit(1);
    }
};

// User Schema
const userSchema = new mongoose.Schema({
    whopUserId: {
        type: String,
        required: true,
        unique: true,
    },
    username: String,
    credits: {
        type: Number,
        default: 10,
    },
    isUnlimited: {
        type: Boolean,
        default: false,
    },
    lastLogin: {
        type: Date,
        default: Date.now,
    },
}, { timestamps: true });

// Prevent recompilation of model if already exists
export const User = mongoose.models.User || mongoose.model('User', userSchema);

// Analysis Schema
const analysisSchema = new mongoose.Schema({
    whopUserId: {
        type: String,
        required: true,
        index: true,
    },
    symbol: String,
    price: Number,
    verdict: {
        direction: String,
        confidence: Number,
        summary: String,
        targets: {
            entry: String,
            stopLoss: String,
            target: String
        }
    },
    thought_process: [
        {
            header: String,
            content: String
        }
    ],
    timestamp: {
        type: Date,
        default: Date.now,
    },
    // Store technicals as a sub-object for record keeping
    technicals: mongoose.Schema.Types.Mixed
}, { timestamps: true });

export const Analysis = mongoose.models.Analysis || mongoose.model('Analysis', analysisSchema);

// Conversation Schema
const conversationSchema = new mongoose.Schema({
    whopUserId: {
        type: String,
        required: true,
        index: true,
    },
    title: String,
    messages: [
        {
            role: { type: String, enum: ['user', 'ai', 'system'] },
            content: String,
            timestamp: { type: Date, default: Date.now }
        }
    ],
    lastMessageAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
