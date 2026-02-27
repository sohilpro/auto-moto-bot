const mongoose = require("mongoose");

// هر کاربر چه ویژگی‌هایی دارد؟
const userSchema = new mongoose.Schema(
  {
    chatId: { type: Number, required: true, unique: true }, // آیدی تلگرام
    isActive: { type: Boolean, default: true },
    firstName: {type: String, default: "کاربر"},
    filters: {
      minPrice: { type: Number, default: 0 },
      maxPrice: { type: Number, default: 99999999999 }, // مثلا تا ۱۰۰ میلیارد
      query: { type: String, default: "" }, // مثلا "۲۰۶ سفید"
      cityId: { type: Number, default: 6 },
      // ✅ اضافه شدن فیلد کلمات منفی به صورت آرایه
      negativeWords: { type: [String], default: [] },
    },
    subscriptionExpiry: { type: Date, default: Date.now },
    // سطح اشتراک کاربر
    plan: {
      type: String,
      enum: ["bronze", "silver", "gold"],
      default: "bronze",
    },

    state: { type: String, default: "IDLE" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
