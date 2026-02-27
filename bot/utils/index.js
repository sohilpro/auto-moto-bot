const axios = require("axios");
const { REQUIRED_CHANNELS } = require("../static/constant");
const { Markup } = require("telegraf");
const randomUseragent = require("random-useragent");
// ================= توابع کمکی (آوردم اینجا که ارور نده) =================

// ۱. تبدیل قیمت
function parsePriceNew(text) {
  if (!text || text.includes("توافقی")) return "توافقی";
  const en = text
    .toString()
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const num = parseInt(en.replace(/[^0-9]/g, ""));
  return isNaN(num) ? "توافقی" : num;
}

// ۲. بررسی تاریخ (فقط امروز)
function getTodayDateStr() {
  return new Date().toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" });
}

function isAdFromToday(isoDateString) {
  if (!isoDateString) return false;
  const adDate = new Date(isoDateString).toLocaleDateString("fa-IR", {
    timeZone: "Asia/Tehran",
  });
  return adDate === getTodayDateStr();
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)) // تبدیل اعداد فارسی به انگلیسی
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)); // تبدیل اعداد عربی
}

// ۱. دریافت متن کامل آگهی از دیوار (فقط برای آگهی‌های هدف)
async function fetchFullAdDetails(token) {
  try {
    const randomUA = randomUseragent.getRandom();

    // کپی کردن هدرهای مرورگر واقعی تا دیوار متوجه ربات نشود
    const headers = {
      Accept: "application/json, text/plain, */*",
      "User-Agent": randomUA,
      Origin: "https://divar.ir",
      Referer: `https://divar.ir/v/${token}`, // رفرر داینامیک به صفحه خود آگهی
      "sec-ch-ua":
        '"Chromium";v="120", "Google Chrome";v="120", "Not=A?Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
    };

    const response = await axios.get(
      `https://api.divar.ir/v8/posts-v2/web/${token}`,
      { headers }, // 👈 ارسال هدرها در درخواست GET
    );

    return response.data;
  } catch (error) {
    // 🔥 پیدا کردن دلیل اصلی خطا
    const statusCode = error.response ? error.response.status : "قطع شبکه";

    if (statusCode === 404) {
      console.log(
        `⚠️ آگهی ${token} قبل از دریافت جزئیات توسط فروشنده پاک شد (404).`,
      );
    } else if (statusCode === 403 || statusCode === 429) {
      console.error(
        `⛔ دیوار درخواست جزئیات آگهی ${token} را مسدود کرد (ارور ${statusCode}).`,
      );
    } else {
      console.error(`❌ خطای ناشناخته در دریافت آگهی ${token}:`, error.message);
    }

    return null;
  }
}

// ۲. تحلیل متن توضیحات با Regex (شاسی و وضعیت بدنه)
// جایگزین تابع قبلی کنید
function analyzeCarCondition(divarJson) {
  const result = {
    tags: [], // دیگر نیازی به isRecommended و issues نداریم
    chassis: "نامشخص",
    body: "نامشخص",
    engine: "نامشخص",
  };

  // ۱. بررسی نوع فروشنده
  const businessType = divarJson.webengage?.business_type;
  if (businessType === "personal") result.tags.push("👤 مصرف‌کننده");
  else result.tags.push("🏢 نمایشگاه/دلال");

  let hasStructuredChassis = false;
  let hasStructuredBody = false;

  let frontChassis = null;
  let rearChassis = null;
  let generalChassis = null;

  const listDataSection = divarJson.sections?.find(
    (sec) => sec.section_name === "LIST_DATA",
  );

  if (listDataSection) {
    const scoreWidgets = listDataSection.widgets.filter(
      (w) => w.widget_type === "SCORE_ROW",
    );

    const isBadChassis = (text) =>
      text.includes("ضربه") ||
      text.includes("خوردگی") ||
      text.includes("جوش") ||
      text.includes("رنگ") ||
      text.includes("ترک");
    const isGoodChassis = (text) =>
      text.includes("سالم") || text.includes("پلمپ");

    for (const widget of scoreWidgets) {
      const title = widget.data.title;
      const score = widget.data.descriptive_score;

      if (title === "وضعیت شاسی‌ها") {
        hasStructuredChassis = true;
        generalChassis = score;
      } else if (title === "شاسی جلو") {
        hasStructuredChassis = true;
        frontChassis = score;
      } else if (title === "شاسی عقب") {
        hasStructuredChassis = true;
        rearChassis = score;
      }

      // بررسی بدنه
      if (title === "بدنه") {
        hasStructuredBody = true;
        result.body = score;

        if (
          score.includes("سالم") ||
          score.includes("بی‌رنگ") ||
          score.includes("بدون رنگ")
        ) {
          result.tags.push("✨ بدنه سالم/بی‌رنگ");
        } else if (
          score.includes("تمام رنگ") ||
          score.includes("تصادفی") ||
          score.includes("چپی")
        ) {
          // 🔥 تغییر مهم: حالا خرابی‌ها مستقیماً تبدیل به تگ می‌شوند
          result.tags.push(`🚨 بدنه: ${score}`);
        } else {
          result.tags.push(`🖍️ بدنه: ${score}`);
        }
      }

      // بررسی موتور
      if (title === "موتور") {
        result.engine = score;
        if (score.includes("سالم")) {
          result.tags.push("⚙️ موتور سالم");
        } else {
          result.tags.push(`⚠️ موتور: ${score}`); // 🔥 تبدیل به تگ هشدار
        }
      }
    }

    // پردازش نهایی شاسی‌ها
    if (hasStructuredChassis) {
      if (generalChassis) {
        result.chassis = generalChassis;
        if (isGoodChassis(generalChassis)) result.tags.push("✅ شاسی پلمپ");
        else result.tags.push(`⚠️ شاسی: ${generalChassis}`); // 🔥 تبدیل به تگ هشدار
      } else {
        let chassisParts = [];

        if (frontChassis) {
          chassisParts.push(`جلو: ${frontChassis}`);
          if (isGoodChassis(frontChassis)) result.tags.push("✅ شاسی جلو پلمپ");
          else result.tags.push(`⚠️ جلو: ${frontChassis}`); // 🔥 تبدیل به تگ هشدار
        }

        if (rearChassis) {
          chassisParts.push(`عقب: ${rearChassis}`);
          if (isGoodChassis(rearChassis)) result.tags.push("✅ شاسی عقب پلمپ");
          else result.tags.push(`⚠️ عقب: ${rearChassis}`); // 🔥 تبدیل به تگ هشدار
        }

        result.chassis = chassisParts.join(" | ");
      }
    }
  }

  // Fallback (تشخیص از روی متن توضیحات)
  const description = divarJson.seo?.description || "";
  const normalizedDesc = description.replace(/\u200C/g, " ").toLowerCase();

  if (!hasStructuredChassis) {
    if (
      normalizedDesc.match(
        /(شاسی.*خوردگی|شاسی.*ضربه|شاسی.*جوش|چپی|تصادفی|اتاق تعویض|شاسی.*ترک|دو تیکه)/,
      )
    ) {
      result.tags.push("🚨 شاسی آسیب‌دیده (حدس از متن)"); // 🔥 اضافه شدن به تگ‌ها
      result.chassis = "آسیب‌دیده (حدس از متن)";
    } else if (
      normalizedDesc.match(/(شاسی.*پلمپ|شاسی.*سالم|بدون ضربه|شاسی ها پلمپ)/)
    ) {
      result.tags.push("✅ شاسی پلمپ");
      result.chassis = "پلمپ (حدس از متن)";
    }
  }

  if (!hasStructuredBody) {
    if (
      normalizedDesc.match(/(تمام رنگ|دور رنگ|دوررنگ|رنگ.*کامل|چپی|تصادفی)/)
    ) {
      result.tags.push("🎨 دور/تمام رنگ یا تصادفی (حدس از متن)"); // 🔥 اضافه شدن به تگ‌ها
      result.body = "رنگ‌دار/تصادفی (حدس از متن)";
    } else if (normalizedDesc.match(/(بی رنگ|بدون رنگ|فابریک)/)) {
      result.tags.push("✨ بدون رنگ");
      result.body = "بی‌رنگ (حدس از متن)";
    }
  }

  return result;
}

// ۳. تحلیل خوش‌قیمت بودن
// پارامتر اول: JSON کامل دیوار
// پارامتر دوم: میانگین قیمتی که شما از دیتابیس خودتان برای این ماشین پیدا کردید
function evaluatePrice(divarJson, avgPriceFromDB) {
  // گرفتن قیمت عددی از JSON دیوار
  const currentPrice = divarJson.webengage?.price || 0;

  // ۱. فیلتر کفِ قیمت (زیر ۵۰ میلیون تومان = ۵۰۰,۰۰۰,۰۰۰ ریال)
  // در مثالی که فرستادید قیمت 100000 ریال است که در این شرط گیر می‌افتد
  if (currentPrice > 0 && currentPrice < 50000000) {
    return {
      isGoodDeal: false,
      tag: "⚠️ مشکوک به قیمت فیک / پیش‌پرداخت",
      exactPrice: currentPrice,
      isFakePrice: true, // این فلگ را اضافه کردیم تا در نمایش قیمت استفاده کنیم
    };
  }

  // اگر قیمت کلا صفر بود (توافقی) یا میانگین بازار را نداشتیم
  if (currentPrice === 0 || avgPriceFromDB === 0) {
    return {
      isGoodDeal: false,
      tag: "",
      exactPrice: currentPrice,
      isFakePrice: false,
    };
  }

  const diff = avgPriceFromDB - currentPrice;
  const dropPercent = (diff / avgPriceFromDB) * 100;

  let dealTag = "";
  let isGoodDeal = false;

  // ۲. بررسی منطقیِ درصد افت قیمت
  if (dropPercent >= 40) {
    // اگر ماشین ۴۰ درصد زیر قیمت بازار است، این یک شکار نیست، یک تله است! (تصادفی شدید یا فیک)
    isGoodDeal = false;
    dealTag = `⛔ بسیار زیر قیمت عرف (احتمالاً مشکل‌دار یا حواله)`;
  } else if (dropPercent >= 10 && dropPercent < 40) {
    // بازه منطقی برای شکار واقعی (بین ۱۰ تا ۴۰ درصد زیر قیمت)
    isGoodDeal = true;
    dealTag = `🔥 شکار روز (${Math.round(dropPercent)}% زیر فی بازار)`;
  } else if (dropPercent >= 5 && dropPercent < 10) {
    // بازه خوش‌قیمت
    isGoodDeal = true;
    dealTag = `✅ خوش‌قیمت`;
  }

  return {
    isGoodDeal,
    tag: dealTag,
    exactPrice: currentPrice,
    isFakePrice: false,
  };
}

function extractCarSpecs(divarJson) {
  let year = "نامشخص";
  let mileage = "نامشخص";
  const extraSpecs = []; // آرایه برای نگهداری تمام ویژگی‌های دیگر

  const listDataSection = divarJson.sections?.find(
    (sec) => sec.section_name === "LIST_DATA",
  );

  if (listDataSection) {
    // گرفتن اطلاعات از GROUP_INFO_ROW (معمولا شامل کارکرد، سال تولید، رنگ)
    const groupInfo = listDataSection.widgets.find(
      (w) => w.widget_type === "GROUP_INFO_ROW",
    );
    if (groupInfo && groupInfo.data.items) {
      for (const item of groupInfo.data.items) {
        if (item.title === "مدل (سال تولید)") year = item.value;
        else if (item.title === "کارکرد") mileage = item.value;
        else extraSpecs.push({ title: item.title, value: item.value });
      }
    }

    // گرفتن اطلاعات از UNEXPANDABLE_ROW (معمولا شامل نوع سوخت، گیربکس، بیمه، معاوضه و...)
    const unexpandableRows = listDataSection.widgets.filter(
      (w) => w.widget_type === "UNEXPANDABLE_ROW",
    );

    for (const row of unexpandableRows) {
      const title = row.data.title;
      const value = row.data.value;

      // قیمت پایه را در اینجا نادیده می‌گیریم چون در جای دیگر نمایش داده می‌شود
      if (title && value && title !== "قیمت پایه") {
        extraSpecs.push({ title, value });
      }
    }
  }

  return {
    brandModel: divarJson.webengage?.brand_model,
    year: year,
    mileage: mileage,
    extraSpecs: extraSpecs, // ارسال تمام ویژگی‌های استخراج شده
  };
}

async function checkMemberStatus(ctx, userId) {
  for (const channel of REQUIRED_CHANNELS) {
    try {
      const member = await ctx.telegram.getChatMember(channel.id, userId);
      // وضعیت‌هایی که یعنی کاربر عضو نیست
      const nonMemberStatus = ["left", "kicked", "restricted"];
      if (nonMemberStatus.includes(member.status)) {
        return false;
      }
    } catch (error) {
      console.error(`خطا در چک کردن عضویت کانال ${channel.id}:`, error);
      return false; // اگر ربات در کانال ادمین نباشد یا کانال وجود نداشته باشد
    }
  }
  return true;
}
function getJoinKeyboard(channels) {
  const buttons = channels.map((ch) => [
    Markup.button.url("📢 عضویت در کانال", ch.link),
  ]);
  buttons.push([
    Markup.button.callback("✅ عضو شدم (بررسی دوباره)", "check_again"),
  ]);
  return Markup.inlineKeyboard(buttons);
}

module.exports = {
  parsePriceNew,
  isAdFromToday,
  getTodayDateStr,
  normalizeText,
  fetchFullAdDetails,
  evaluatePrice,
  analyzeCarCondition,
  extractCarSpecs,
  checkMemberStatus,
  getJoinKeyboard,
};
