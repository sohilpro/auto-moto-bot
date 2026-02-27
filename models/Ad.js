// models/Ad.js
const mongoose = require("mongoose");

const adSchema = new mongoose.Schema(
  {
    // شناسه یکتای دیوار (توکن)
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // عنوان آگهی
    title: {
      type: String,
      required: true,
    },
    // مدل دقیق و سیستمی ماشین
    brandModel: {
      type: String,
      required: true,
      index: true,
    },
    // سال تولید ماشین
    year: {
      type: Number,
      required: true,
      index: true,
    },
    // قیمت دقیق
    price: {
      type: Number,
      required: true,
      index: true,
    },
    // کارکرد ماشین
    mileage: {
      type: Number,
      default: 0,
    },

    // 🔥 نام متنی شهر
    city: {
      type: String,
      required: true,
    },
    // 🔥 آیدی عددی شهر
    cityId: {
      type: Number,
      required: true,
      index: true,
    },
    // محدوده/محله
    district: {
      type: String,
      default: "نامشخص",
    },

    // نوع فروشنده
    businessType: {
      type: String,
      default: "unknown",
    },

    // --- اطلاعات فنی ---
    chassisCondition: {
      type: String,
      default: "نامشخص",
    },
    bodyCondition: {
      type: String,
      default: "نامشخص",
    },
    engineCondition: {
      type: String,
      default: "نامشخص",
    },
    publishTimeText: {
      type: String,
      default: "لحظاتی پیش",
    },

    // توضیحات کامل آگهی
    description: {
      type: String,
    },
    // لینک اولین عکس آگهی
    imageUrl: {
      type: String,
    },
    // تگ‌های هوشمند (وضعیت بدنه و ...)
    tags: [
      {
        type: String,
      },
    ],

    // ==========================================
    // 🆕 فیلدهای جدید اضافه شده برای هماهنگی با تلگرام
    // ==========================================

    // لینک مستقیم مختصات گوگل مپ (در صورت وجود)
    mapUrl: {
      type: String,
      default: null,
    },

    // برچسب ارزیابی قیمت (مثل "🔥 شکار روز (۱۵٪ زیر فی)")
    dealTag: {
      type: String,
      default: "",
    },

    // لیست مشخصات تکمیلی (گیربکس، سوخت، بیمه و ...)
    // به صورت آرایه‌ای از آبجکت‌ها ذخیره می‌کنیم تا جستجو در دیتابیس راحت‌تر باشد
    extraSpecs: [
      {
        title: String,
        value: String,
      },
    ],
  },
  {
    timestamps: true,
  },
);

// =========================================================================
// 🚀 ایندکس‌های ترکیبی (Compound Indexes)
// =========================================================================
adSchema.index({ cityId: 1, brandModel: 1, year: 1, createdAt: -1, price: 1 });

// 🔥 اضافه کردن سیستم انهدام خودکار (TTL Index)
// عدد بر حسب ثانیه است.
// ۱۴ روز = 14 * 24 * 60 * 60 = 1209600 ثانیه
adSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1209600 });

module.exports = mongoose.model("Ad", adSchema);
