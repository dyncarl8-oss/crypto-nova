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
        default: 3,
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
