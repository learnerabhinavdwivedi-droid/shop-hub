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
