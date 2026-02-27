const Ad = require("../../models/Ad");

// تابع کمکی برای تبدیل اعداد فارسی سال (مثل "۱۴۰۰") به انگلیسی ("1400")
function normalizeYear(yearStr) {
  if (!yearStr) return "";
  const persianNumbers = [
    /۰/g,
    /۱/g,
    /۲/g,
    /۳/g,
    /۴/g,
    /۵/g,
    /۶/g,
    /۷/g,
    /۸/g,
    /۹/g,
  ];
  let englishStr = yearStr.toString();
  for (let i = 0; i < 10; i++) {
    englishStr = englishStr.replace(persianNumbers[i], i);
  }
  return englishStr;
}

/**
 * دریافت میانگین قیمت ماشین از دیتابیس بر اساس مدل و سال
 * @param {String} brandModel - مدل ماشین (مثل "Peugeot Pars latest" یا "کوییک GXR")
 * @param {String} year - سال تولید (مثل "1400" یا "۱۴۰۰")
 */
async function getAveragePriceFromDB(brandModel, year) {
  if (!brandModel || !year) return 0;

  const englishYear = normalizeYear(year);

  // محاسبه تاریخ ۱۴ روز پیش برای فیلتر کردن آگهی‌های قدیمی
  const timeWindow = new Date();
  timeWindow.setDate(timeWindow.getDate() - 14);

  try {
    // استفاده از Aggregation در مونگو برای محاسبه میانگین در سطح دیتابیس (بسیار سریع)
    const result = await Ad.aggregate([
      {
        $match: {
          // تطابق دقیق مدل ماشین (چه انگلیسی چه فارسی، بسته به چیزی که ذخیره کردید)
          brandModel: brandModel,

          // تطابق سال تولید
          year: englishYear,

          // فقط آگهی‌های ۱۴ روز اخیر (برای درک نوسانات جدید بازار)
          createdAt: { $gte: timeWindow },

          // حذف قیمت‌های فیک یا پیش‌پرداخت (مثلاً زیر ۵۰ میلیون تومان)
          price: { $gt: 50000000 },
        },
      },
      {
        $group: {
          _id: null,
          avgPrice: { $avg: "$price" }, // محاسبه میانگین قیمت‌ها
          count: { $sum: 1 }, // شمارش تعداد آگهی‌های پیدا شده
          minPrice: { $min: "$price" }, // کمترین قیمت ثبت شده (برای لاگ زدن خوب است)
          maxPrice: { $max: "$price" }, // بیشترین قیمت ثبت شده
        },
      },
    ]);

    // اگر دیتابیس نتیجه‌ای برگرداند
    if (result.length > 0) {
      const data = result[0];

      // اگر حداقل ۳ آگهی برای این مدل در ۱۴ روز گذشته داشتیم، میانگین معتبر است
      if (data.count >= 3) {
        return Math.round(data.avgPrice);
      } else {
        console.log(
          `⚠️ دیتای کافی برای میانگین‌گیری وجود ندارد (فقط ${data.count} آگهی یافت شد).`,
        );
        return 0;
      }
    } else {
      return 0; // هیچ آگهی مشابهی در دیتابیس یافت نشد
    }
  } catch (error) {
    console.error("❌ خطا در محاسبه میانگین قیمت از دیتابیس:", error);
    return 0;
  }
}

module.exports = {
  getAveragePriceFromDB,
  normalizeYear,
};
