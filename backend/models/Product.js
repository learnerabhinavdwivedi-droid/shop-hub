const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    productName: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },
    store: {
        type: String,
        required: true,
        lowercase: true
    },
    url: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String,
        default: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&q=80&w=300'
    },
    priceHistory: [
        {
            price: {
                type: Number,
                required: true
            },
            date: {
                type: Date,
                default: Date.now
            }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('Product', ProductSchema);
