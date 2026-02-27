require("dotenv").config();
const { Telegraf, Markup, session, Scenes } = require("telegraf");
const axios = require("axios");
const mongoose = require("mongoose");
const User = require("../models/User"); // فایل مدل دیتابیس باید کنار پروژه باشد
const Ad = require("../models/Ad");
const {
  getTodayDateStr,
  isAdFromToday,
  parsePriceNew,
  normalizeText,
  fetchFullAdDetails,
  analyzeCarCondition,
  evaluatePrice,
  extractCarSpecs,
  checkMemberStatus,
  getJoinKeyboard,
} = require("./utils");
const randomUseragent = require("random-useragent");
const {
  getAveragePriceFromDB,
  normalizeYear,
} = require("./utils/AveragePrice");
const {
  MESSAGES,
  LIMITS,
  PLANS,
  REQUIRED_CHANNELS,
  SUPPORTED_CITIES,
} = require("./static/constant");
const {
  setupAdmin,
  userManageScene,
  broadcastScene,
  tokenManageScene,
} = require("../admin/index");
const { getRandomToken, removeBadToken } = require("./utils/tokenManager");

// ================= تنظیمات =================
const BOT_TOKEN = process.env.BOT_TOKEN; // ⚠️ توکن جدید رو اینجا بذار
const CHECK_INTERVAL = 60;
const MONGO_URI = process.env.MONGO_URI;
const DIVAR_URL = "https://api.divar.ir/v8/postlist/w/search";

const bot = new Telegraf(BOT_TOKEN);

bot.use((ctx, next) => {
  if (
    ctx.update.message?.text?.startsWith("/admin") ||
    ctx.update.callback_query?.data?.startsWith("admin_")
  ) {
    if (ctx.from.id !== Number(process.env.ADMIN_ID)) {
      return ctx.reply("شما دسترسی به این بخش را ندارید.");
    }
  }
  return next();
});

// ۱. حتما باید از session استفاده کنی چون پنل ادمین WizardScene دارد
bot.use(session());

// ۲. تعریف Stage برای مدیریت صحنه‌ها (Scenes)
const stage = new Scenes.Stage([
  /* صحنه‌های ادمین و کاربر اینجا */
  userManageScene,
  broadcastScene,
  tokenManageScene,
]);
bot.use(stage.middleware());

setupAdmin(bot);

// اتصال به دیتابیس
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ Mongo Error:", err));

// ================= مدیریت حافظه هوشمند =================
let currentDayStr = getTodayDateStr();

// ================= کیبوردها =================

const mainMenuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("💎 خرید اشتراک ویژه", "buy_sub")],
  [
    Markup.button.callback("⚙️ تنظیمات فیلتر", "settings_menu"),
    Markup.button.callback("👤 وضعیت من", "my_profile"),
  ],
  [
    Markup.button.callback("🛑 توقف ربات", "stop_bot"),
    Markup.button.callback("▶️ شروع مجدد", "start_bot"),
  ],
  [Markup.button.callback("🎯 دریافت ۵ شکار برتر امروز", "fetch_today_ads")],
  [Markup.button.callback("❓ راهنمای ربات", "help_center")],
  [Markup.button.url("📞 پشتیبانی", "https://t.me/sohilpro")],
]);

const settingsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("📍 تغییر شهر", "change_city")], // 👈 دکمه جدید اضافه شد
  [Markup.button.callback("🔍 تنظیم کلمه جستجو", "set_query")],
  [Markup.button.callback("❌ حذف کلمه جستجو (نمایش همه)", "clear_query")],
  [
    Markup.button.callback("💰 تعیین سقف قیمت", "set_max_price"),
    Markup.button.callback("🚫 کلمات منفی", "manage_negatives"),
  ],
  [Markup.button.callback("🔙 بازگشت به منو", "main_menu")],
]);

const backButton = Markup.inlineKeyboard([
  [Markup.button.callback("🔙 بازگشت", "main_menu")],
]);

// ================= هندلرهای ربات =================

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  const firstName = ctx.from.first_name || "کاربر";

  const isMember = await checkMemberStatus(ctx, chatId);

  if (!isMember) {
    return ctx.reply(
      "👋 برای استفاده از ربات اتوآنالیز، ابتدا باید در کانال‌های زیر عضو شوید:",
      getJoinKeyboard(REQUIRED_CHANNELS),
    );
  }

  const trialDate = new Date();
  trialDate.setDate(trialDate.getDate() + 2); // الان + ۲ روز
  let user = await User.findOne({
    chatId,
  });
  if (!user) {
    user = await User.create({
      chatId,
      firstName,
      subscriptionExpiry: trialDate,
      filters: { maxPrice: 500_000_000, cityId: 6 },
      plan: "silver",
    });
  } else {
    // 🔄 آپدیت اطلاعات کاربر قدیمی (اگر اسم یا آیدی خود را در تلگرام عوض کرده باشد)
    if (user.firstName !== firstName || user.chatId !== chatId) {
      await User.updateOne({ chatId }, { firstName, chatId });
    }
  }

  const welcomeText = MESSAGES.WELCOME(firstName);

  await ctx.replyWithHTML(welcomeText, mainMenuKeyboard);
});

bot.help(async (ctx) => {
  await ctx.replyWithHTML(
    MESSAGES.HELP_TEXT,
    Markup.inlineKeyboard([
      [Markup.button.callback("💎 مشاهده پلن‌های اشتراک", "buy_sub")],
      [Markup.button.callback("🔙 بازگشت به منو", "main_menu")],
    ]),
  );
});

bot.action("change_city", async (ctx) => {
  const user = await User.findOne({ chatId: ctx.from.id });
  if (!user)
    return ctx.answerCbQuery("ابتدا ربات را /start کنید.", {
      show_alert: true,
    });

  // پیدا کردن شهر فعلی کاربر
  const currentCity = SUPPORTED_CITIES[user.filters.cityId];
  const currentCityName = currentCity ? currentCity.nameFa : "نامشخص";

  const buttons = [];
  const cityIds = Object.keys(SUPPORTED_CITIES);

  // ساخت دکمه‌های شهرها (دو تا در هر ردیف)
  for (let i = 0; i < cityIds.length; i += 2) {
    const row = [];

    const id1 = cityIds[i];
    const isSelected1 = user.filters.cityId === Number(id1);
    row.push(
      Markup.button.callback(
        isSelected1
          ? `✅ ${SUPPORTED_CITIES[id1].nameFa}`
          : SUPPORTED_CITIES[id1].nameFa,
        `set_city_${id1}`,
      ),
    );

    if (i + 1 < cityIds.length) {
      const id2 = cityIds[i + 1];
      const isSelected2 = user.filters.cityId === Number(id2);
      row.push(
        Markup.button.callback(
          isSelected2
            ? `✅ ${SUPPORTED_CITIES[id2].nameFa}`
            : SUPPORTED_CITIES[id2].nameFa,
          `set_city_${id2}`,
        ),
      );
    }
    buttons.push(row);
  }

  // اضافه کردن دکمه بازگشت به تنظیمات در پایین لیست شهرها
  buttons.push([
    Markup.button.callback("🔙 بازگشت به تنظیمات", "settings_menu"),
  ]);
  // ⚠️ نکته: اگر دکمه تنظیمات شما اسم دیگری دارد (مثلا open_settings)، نام "settings_menu" را تغییر دهید.

  await ctx.editMessageText(
    `📍 **تنظیمات شهر**\n\nشهر فعلی شما: **${currentCityName}**\n\nلطفاً شهر مورد نظر خود را برای دریافت آگهی‌ها انتخاب کنید:`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    },
  );
});

bot.action("check_again", async (ctx) => {
  const userId = ctx.from.id;
  const isMember = await checkMemberStatus(ctx, userId);

  if (isMember) {
    await ctx.answerCbQuery("✅ عضویت تایید شد!");
    await ctx.editMessageText(
      "بسیار عالی! حالا می‌توانید از ربات استفاده کنید:",
      mainMenuKeyboard,
    );
  } else {
    await ctx.answerCbQuery("❌ شما هنوز در تمام کانال‌ها عضو نشده‌اید!", {
      show_alert: true,
    });
  }
});

bot.action("buy_sub", async (ctx) => {
  try {
    // توقف لودینگ دکمه
    await ctx.answerCbQuery("لیست اشتراک‌ها 🛒");

    // اطلاعات پرداخت شما
    const cardNumber = "6219861964347883"; // شماره کارت بدون خط فاصله برای کپی راحت‌تر
    const cardHolder = "رضا خباز خرامه";
    const supportUsername = "sohilpro"; // آیدی پشتیبانی بدون @

    // ساختار متن پیام (با فرمت HTML)
    const messageText = `
💎 <b>تعرفه‌های خرید اشتراک ربات</b> 💎

برای دسترسی به بهترین آگهی‌های بازار، یکی از پلن‌های زیر را انتخاب کنید:

🥉 <b>پلن برنزی (۱ ماهه) — ۹۹,۰۰۰ تومان</b>
▫️ دریافت آنی آگهی‌های جدید
▫️ فیلتر بر اساس مدل، سال و قیمت

🥈 <b>پلن نقره‌ای (۱ ماهه) — ۱۹۹,۰۰۰ تومان</b>
▫️ <i>تمام امکانات پلن برنزی +</i>
▫️ تشخیص آگهی دلال از مصرف‌کننده 🕵️‍♂️
▫️ فیلتر کلمات منفی (حذف آگهی‌های تصادفی و حواله)

🥇 <b>پلن شکارچی ویژه (۱ ماهه) — ۳۹۹,۰۰۰ تومان</b>
▫️ <i>تمام امکانات پلن نقره‌ای +</i>
▫️ <b>تشخیص آگهی‌های زیر فی و شکار بازار 🔥</b>
▫️ استخراج تاریخچه آگهی و تغییرات قیمت 📊
▫️ اولویت ارسال در کسری از ثانیه

➖➖➖➖➖➖➖➖➖➖

💳 <b>شماره کارت جهت واریز:</b>
<code>${cardNumber}</code>
👤 بنام: ${cardHolder}

<b>✅ نحوه فعال‌سازی:</b>
۱. مبلغ پلن مورد نظر خود را واریز کنید. (روی شماره کارت بزنید تا کپی شود)
۲. رسید واریز + نام پلن انتخابی را از طریق دکمه زیر برای پشتیبانی بفرستید.

شناسه کاربری شما جهت پیگیری: <code>${ctx.from.id}</code>
`;

    // دکمه‌های زیر پیام
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.url(
          "💬 ارسال رسید به پشتیبانی",
          `https://t.me/${supportUsername}`,
        ),
      ],
      [Markup.button.callback("بازگشت به منوی اصلی 🔙", "main_menu")], // اکشن بازگشت (متناسب با ربات خودتان تغییر دهید)
    ]);

    // ارسال یا ویرایش پیام
    await ctx.editMessageText(messageText, {
      parse_mode: "HTML",
      ...keyboard,
    });
  } catch (error) {
    console.error("Error in buy_sub action:", error);
    await ctx.reply(
      "❌ خطایی رخ داده است. لطفاً مستقیماً با پشتیبانی در ارتباط باشید.",
    );
  }
});

bot.action("main_menu", async (ctx) => {
  await User.updateOne({ chatId: ctx.from.id }, { state: "IDLE" });
  await ctx
    .editMessageText("به منوی اصلی خوش آمدید:", mainMenuKeyboard)
    .catch(() => {});
});

bot.action("settings_menu", (ctx) => {
  ctx.editMessageText("تنظیمات فیلترها:", settingsKeyboard);
});

bot.action("my_profile", async (ctx) => {
  const user = await User.findOne({ chatId: ctx.chat.id });
  if (!user) return ctx.answerCbQuery("کاربر یافت نشد!", { show_alert: true });

  // محاسبه روزهای باقی‌مانده
  const now = new Date();
  const expiry = new Date(user.subscriptionExpiry);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let statusText = diffDays > 0 ? `🟢 فعال (${diffDays} روز)` : `🔴 منقضی شده`;

  // نمایش کلمه جستجو در پروفایل
  const queryShow = user.filters?.query ? user.filters.query : "همه آگهی‌ها";

  const planNames = {
    bronze: "برنزی 🥉",
    silver: "نقره‌ای 🥈",
    gold: "شکارچی (VIP) 🥇",
  };

  // اگر کاربر پلن نداشت، پیش‌فرض همان برنزی در نظر گرفته می‌شود
  const userPlanDisplay = planNames[user.plan] || "برنزی 🥉";

  // ==========================================
  // 📍 پیدا کردن نام شهر کاربر
  // ==========================================
  // اطمینان حاصل کنید که SUPPORTED_CITIES در بالای فایل شما تعریف شده یا import شده باشد
  const cityId = user.filters.cityId || 6; // اگر ثبت نکرده بود، پیش‌فرض 5 (شیراز)
  const cityName = SUPPORTED_CITIES[cityId]
    ? SUPPORTED_CITIES[cityId].nameFa
    : "نامشخص";

  const text = `👤 **پروفایل شما:**\n
💎 سطح اشتراک: ${userPlanDisplay}
📊 وضعیت: ${statusText}
📅 تاریخ انقضا: ${diffDays > 0 ? expiry.toLocaleDateString("fa-IR") : "پایان یافته"}
🏙 شهر فعال: ${cityName}
💰 سقف قیمت: ${user.filters?.maxPrice > 0 ? user.filters.maxPrice.toLocaleString() + " تومان" : "بدون محدودیت"}
🔍 کلمه جستجو: ${queryShow}`;

  // اگر parse_mode MarkdownV2 یا HTML نیاز دارید حتما به متد زیر اضافه کنید
  await ctx.editMessageText(text, {
    parse_mode: "Markdown", // چون از ** برای بولد کردن استفاده کردید
    ...backButton, // دکمه بازگشت شما
  });
});

bot.action("upgrade_to_gold_alert", (ctx) => {
  return ctx.answerCbQuery(
    "⚠️ مشاهده مستقیم شماره تماس فقط برای اعضای پنل طلایی (شکارچی) امکان‌پذیر است.",
    { show_alert: true },
  );
});

// وقتی کاربر روی دکمه "🚫 کلمات منفی" کلیک می‌کند
bot.action("manage_negatives", async (ctx) => {
  const chatId = ctx.from.id;
  const user = await User.findOne({ chatId });

  if (user.plan === "bronze") {
    return ctx.answerCbQuery("❌ این قابلیت مخصوص کاربران VIP است", {
      show_alert: true,
    });
  }

  // فعال کردن وضعیت انتظار در دیتابیس
  await User.updateOne({ chatId }, { state: "WAITING_FOR_NEGATIVES" });

  const currentWords =
    user.filters?.negativeWords?.length > 0
      ? user.filters.negativeWords.map((w) => `<code>${w}</code>`).join(" - ")
      : "خالی";

  await ctx.answerCbQuery();
  await ctx.reply(
    `🚫 **مدیریت کلمات منفی (هوشمند)**\n\n` +
      `کلمات فعلی: ${currentWords}\n\n` +
      `• کاراکترهای خاص (!@#) خودکار حذف می‌شوند.\n` +
      `• کلمات را با کاما (،) از هم جدا کنید.\n\n` +
      `👇 کلمات جدید را بفرستید یا از دکمه‌های زیر استفاده کنید:`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "🗑 پاکسازی همه کلمات",
            "clear_negatives_action",
          ),
        ],
        [Markup.button.callback("🔙 بازگشت", "settings_menu")],
      ]),
    },
  );
});

bot.action("clear_negatives_action", async (ctx) => {
  try {
    const chatId = ctx.from.id;

    // ۱. خالی کردن آرایه کلمات منفی در دیتابیس
    await User.updateOne({ chatId }, { $set: { "filters.negativeWords": [] } });

    // ۲. اطلاع‌رسانی به کاربر (پاسخ به کلیک دکمه)
    await ctx.answerCbQuery("🗑 لیست کلمات منفی پاک شد");

    // ۳. ویرایش پیام فعلی برای نمایش وضعیت جدید
    // از .catch برای جلوگیری از ارور "message is not modified" استفاده می‌کنیم
    await ctx
      .editMessageText(
        "🗑 تمام کلمات منفی شما پاک شدند. اکنون تمامی آگهی‌ها برای شما ارسال خواهند شد.",
        settingsKeyboard, // بازگشت به منوی تنظیمات
      )
      .catch((err) => {
        if (!err.description.includes("message is not modified")) {
          console.error("Error editing message:", err);
        }
      });
  } catch (error) {
    console.error("Error in clear_negatives_action:", error);
    await ctx.answerCbQuery("❌ خطایی رخ داد", { show_alert: true });
  }
});

bot.action("fetch_today_ads", async (ctx) => {
  try {
    await ctx.answerCbQuery("در حال جستجو در دیتابیس...");
    const chatId = ctx.from.id;

    const user = await User.findOne({ chatId: chatId });
    if (!user || !user.isActive || user.subscriptionExpiry < new Date()) {
      return ctx.reply("❌ اشتراک شما فعال نیست یا به پایان رسیده است.");
    }

    // ۱. اعمال محدودیت تعداد آگهی بر اساس پلن
    let limit = 3; // پیش‌فرض برنزی
    if (user.plan === "silver") limit = 10;
    if (user.plan === "gold") limit = 50;

    const userMaxPrice = user.filters.maxPrice || 0;
    const userQuery = user.filters.query || "";
    const negativeWords = user.filters.negativeWords || [];

    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const dbQuery = {
      createdAt: { $gte: yesterday },
      cityId: user.cityId || 5, // 👈 مطمئن شوید از فیلد درست شهر استفاده می‌کنید
    };

    if (userMaxPrice > 0) {
      dbQuery.price = { $lte: userMaxPrice, $gt: 0 };
    }

    if (userQuery.trim() !== "") {
      const regexQuery = new RegExp(userQuery.trim(), "i");
      dbQuery.$or = [{ title: regexQuery }, { brandModel: regexQuery }];
    }

    // ۲. اعمال فیلتر کلمات منفی (برای نقره‌ای و طلایی)
    if (user.plan !== "bronze" && negativeWords.length > 0) {
      dbQuery.title = { $nin: negativeWords.map((w) => new RegExp(w, "i")) };
    }

    const topAds = await Ad.find(dbQuery).sort({ price: 1 }).limit(limit);

    if (topAds.length === 0) {
      return ctx.reply(
        "متاسفانه در ۲۴ ساعت گذشته، آگهی با مشخصات شما ثبت نشده است.",
      );
    }

    await ctx.reply(
      `🎉 **${topAds.length} آگهی برتر یافت شد (محدودیت پلن ${user.plan}):**`,
      { parse_mode: "Markdown" },
    );

    for (const ad of topAds) {
      // ۳. مدیریت لیبل قیمت
      // اولویت با لیبلی است که ربات موقع اسکرپ محاسبه و ذخیره کرده
      let dealTag = ad.dealTag || "";
      if (!dealTag && ad.price > 0 && ad.price < 400000000) {
        dealTag = "⚠️ مشکوک به پیش‌پرداخت / حواله";
      }

      const formattedPrice =
        ad.price > 0
          ? new Intl.NumberFormat("fa-IR").format(ad.price) + " تومان"
          : "توافقی";

      const formattedMileage =
        ad.mileage > 0
          ? new Intl.NumberFormat("fa-IR").format(ad.mileage) + " کیلومتر"
          : "صفر / نامشخص";

      // ۴. تبدیل آرایه مشخصات فنی (ذخیره شده در دیتابیس) به متن برای تلگرام
      let specsTextForTelegram = "";
      if (ad.extraSpecs && ad.extraSpecs.length > 0) {
        specsTextForTelegram = ad.extraSpecs
          .map((spec) => `▪️ ${spec.title}: ${spec.value}`)
          .join("\n");
      }

      // ۵. ارسال دقیق به تابع sendTelegramAlert با ترتیب پارامترهای جدید
      await sendTelegramAlert(
        chatId,
        ad.title,
        ad.brandModel || "نامشخص", // 👈 مدل ماشین
        ad.year || "نامشخص", // 👈 سال ساخت
        formattedPrice,
        ad.city || "نامشخص", // 👈 نام شهر
        ad.district || "نامشخص",
        formattedMileage,
        ad.token,
        ad.imageUrl,
        ad.tags || [],
        dealTag,
        user.plan,
        ad.publishTimeText || "لحظاتی پیش",
        specsTextForTelegram, // 👈 مشخصات فنی
        ad.description, // 👈 توضیحات آگهی
        ad.mapUrl, // 👈 لینک نقشه
      );

      // مکث کوتاه برای جلوگیری از اسپم شدن ربات توسط تلگرام (Flood Wait Error)
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error("Error in fetch_today_ads:", error);
    await ctx.reply("❌ خطایی در دریافت اطلاعات رخ داد.");
  }
});

bot.action("stop_bot", async (ctx) => {
  await User.updateOne({ chatId: ctx.chat.id }, { isActive: false });
  ctx.editMessageText("🔴 ربات متوقف شد.", backButton);
});

bot.action("start_bot", async (ctx) => {
  await User.updateOne({ chatId: ctx.chat.id }, { isActive: true });
  ctx.editMessageText("🟢 ربات فعال شد.", backButton);
});

bot.action("set_max_price", async (ctx) => {
  const chatId = ctx.from.id;

  await User.updateOne({ chatId }, { state: "WAITING_FOR_MAX_PRICE" });

  await ctx.answerCbQuery();
  await ctx.reply(
    "💰 لطفاً سقف قیمت مورد نظر خود را به تومان وارد کنید:",
    backButton,
  );
});

// ✅ دکمه تنظیم کلمه
bot.action("set_query", async (ctx) => {
  const chatId = ctx.from.id;

  await User.updateOne({ chatId }, { state: "WAITING_FOR_QUERY" });
  ctx.editMessageText(
    "لطفاً کلمه یا عبارت مورد نظر خود را بنویسید.\nمثال: 'پژو 206' یا 'پارس'\n\n(ربات فقط آگهی‌هایی که شامل این کلمه باشند را می‌فرستد)",
    backButton,
  );
});

// ✅ دکمه پاک کردن کلمه
bot.action("clear_query", async (ctx) => {
  try {
    const chatId = ctx.from.id;
    await User.updateOne({ chatId }, { "filters.query": "" });

    // استفاده از try-catch مخصوص برای ادیت پیام
    const now = new Date().toLocaleTimeString("fa-IR");
    await ctx
      .editMessageText(
        `✅ فیلتر کلمه حذف شد.\n🕒 آخرین بروزرسانی: ${now}`,
        settingsKeyboard,
      )
      .catch((err) => {
        // اگر ارور مربوط به "عدم تغییر پیام" بود، نادیده‌اش بگیر
        if (!err.description.includes("message is not modified")) {
          console.error("خطای واقعی در ادیت پیام:", err);
        }
      });

    await ctx.answerCbQuery("فیلتر حذف شد");
  } catch (error) {
    console.error("Error in clear_query action:", error);
  }
});

// استفاده از Regex برای گرفتن توکنِ بعد از عبارت get_phone_
bot.action(/^get_phone_(.+)$/, async (ctx) => {
  const divarToken = getRandomToken();

  if (!divarToken) {
    return ctx.answerCbQuery(
      "❌ سیستم در حال بروزرسانی است. لطفا بعدا تلاش کنید.",
      { show_alert: true },
    );
  }

  try {
    const token = ctx.match[1];
    const chatId = ctx.from.id;

    // ۱. بررسی اشتراک کاربر
    const user = await User.findOne({ chatId: chatId });
    if (!user || !user.isActive || user.subscriptionExpiry < new Date()) {
      return ctx.answerCbQuery("❌ اشتراک شما فعال نیست!", {
        show_alert: true,
      });
    }

    // ۲. نمایش حالت لودینگ
    await ctx.answerCbQuery("⏳ در حال دریافت اطلاعات تماس...");

    // ۳. فراخوانی تابع دریافت شماره‌ها
    const contactsArray = await fetchPhoneNumber(token, divarToken);
    console.log(contactsArray);

    // حتما چک کنید که آرایه خالی یا null نباشد
    if (contactsArray) {
      let replyText = `📞 <b>اطلاعات تماس فروشنده:</b>\n\n`;

      for (const contact of contactsArray) {
        replyText += `▫️ ${contact.title}: <code>${contact.phone}</code>\n`;
      }
      replyText += `\n<i>(روی شماره بزنید تا کپی شود)</i>`;

      await ctx.reply(replyText, {
        parse_mode: "HTML",
        reply_to_message_id: ctx.callbackQuery.message.message_id,
      });
    } else {
      // 🔥 تغییر مهم: حالا به جای پاپ‌آپ، یک پیام واقعی ریپلای می‌شود
      await ctx.reply(
        "⚠️ شماره تماس یافت نشد!\nدلایل احتمالی:\n۱. فروشنده شماره را مخفی کرده است.\n۲. توکن فعلی دیوار محدود (Shadowban) شده است.",
        { reply_to_message_id: ctx.callbackQuery.message.message_id },
      );
    }
  } catch (error) {
    // 🔥 حالا ارورهای Axios مستقیماً به اینجا می‌رسند

    // وضعیت 401 = منقضی، 403 = کپچا/بن، 429 = محدودیت درخواست بیش از حد (Rate Limit)
    if (
      error.response &&
      (error.response.status === 401 ||
        error.response.status === 403 ||
        error.response.status === 429)
    ) {
      // ۱. توکن خراب یا لیمیت شده را از فایل حذف کن
      const leftTokensCount = removeBadToken(divarToken);

      // ۲. به ادمین هشدار بده (همراه با کد ارور که بدونی چرا سوخته)
      bot.telegram.sendMessage(
        process.env.ADMIN_ID,
        `🚨 **هشدار توکن دیوار!**\n\nیک توکن با خطای ${error.response.status} مواجه شد و حذف گردید.\nتعداد توکن‌های سالم: ${leftTokensCount}\n\nتوکن:\n<code>${divarToken}</code>`,
        { parse_mode: "HTML" },
      );

      // ۳. به کاربر بگو دوباره تلاش کنه
      await ctx.answerCbQuery(
        "🔄 اختلال موقت در ارتباط با سرور... لطفاً یکبار دیگر روی دریافت شماره کلیک کنید.",
        { show_alert: true },
      );
    } else {
      console.error(error); // چاپ ارور برای دیباگ خودتان
      await ctx.answerCbQuery("❌ خطای ناشناخته در دریافت شماره.", {
        show_alert: true,
      });
    }
  }
});

// دستور نمایش منوی انتخاب شهر
bot.command("city", async (ctx) => {
  const user = await User.findOne({ chatId: ctx.from.id });
  if (!user) return ctx.reply("ابتدا ربات را /start کنید.");

  // پیدا کردن دیتای شهر فعلی کاربر
  const currentCity = SUPPORTED_CITIES[user.filters.cityId];
  const currentCityName = currentCity ? currentCity.nameFa : "نامشخص";

  const buttons = [];
  const cityIds = Object.keys(SUPPORTED_CITIES);

  // ساخت دکمه‌ها (دو تا در هر ردیف)
  for (let i = 0; i < cityIds.length; i += 2) {
    const row = [];

    const id1 = cityIds[i];
    const isSelected1 = user.filters.cityId === Number(id1);
    row.push(
      Markup.button.callback(
        isSelected1
          ? `✅ ${SUPPORTED_CITIES[id1].nameFa}`
          : SUPPORTED_CITIES[id1].nameFa,
        `set_city_${id1}`, // ارسال آیدی در دکمه
      ),
    );

    if (i + 1 < cityIds.length) {
      const id2 = cityIds[i + 1];
      const isSelected2 = user.filters.cityId === Number(id2);
      row.push(
        Markup.button.callback(
          isSelected2
            ? `✅ ${SUPPORTED_CITIES[id2].nameFa}`
            : SUPPORTED_CITIES[id2].nameFa,
          `set_city_${id2}`,
        ),
      );
    }
    buttons.push(row);
  }

  await ctx.reply(
    `📍 **تنظیمات شهر**\n\nشهر فعلی شما: **${currentCityName}**\n\nلطفاً شهر مورد نظر خود را برای دریافت آگهی‌ها انتخاب کنید:`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } },
  );
});

// اکشن ذخیره شهر
bot.action(/set_city_(\d+)/, async (ctx) => {
  const selectedCityId = Number(ctx.match[1]);

  if (!SUPPORTED_CITIES[selectedCityId]) {
    return ctx.answerCbQuery("❌ شهر نامعتبر است.", { show_alert: true });
  }

  // ذخیره آیدی شهر در دیتابیس
  await User.updateOne(
    { chatId: ctx.from.id },
    { "filters.cityId": selectedCityId },
  );

  const cityName = SUPPORTED_CITIES[selectedCityId].nameFa;
  await ctx.answerCbQuery(`✅ شهر شما به ${cityName} تغییر یافت.`, {
    show_alert: true,
  });

  await ctx
    .editMessageText(
      `✅ تنظیمات ذخیره شد. از این پس آگهی‌های **${cityName}** برای شما بررسی می‌شود.`,
    )
    .catch(() => {});
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  // ۱. پیدا کردن کاربر و وضعیت فعلی او
  const user = await User.findOne({ chatId });
  if (!user) return; // یا ثبت‌نام کاربر جدید

  const step = user.state; // وضعیت را از دیتابیس می‌گیریم

  if (step === "IDLE") {
    return ctx.reply("لطفاً از دکمه‌های منو استفاده کنید 👇", mainMenuKeyboard);
  }

  // ۱. تنظیم سقف قیمت
  if (step === "WAITING_FOR_MAX_PRICE") {
    const price = parsePriceNew(ctx.message.text);
    if (price > 0) {
      await User.updateOne(
        { chatId },
        {
          "filters.maxPrice": price,
          state: "IDLE",
        },
      );
      ctx.reply(
        `✅ سقف قیمت شد: ${price.toLocaleString()} تومان`,
        mainMenuKeyboard,
      );
    } else {
      ctx.reply("❌ فقط عدد وارد کنید:", backButton);
    }
  }

  // ۲. تنظیم کلمه جستجو
  if (step === "WAITING_FOR_QUERY") {
    const query = ctx.message.text;
    await User.updateOne(
      { chatId },
      {
        "filters.query": query,
        state: "IDLE",
      },
    );
    ctx.reply(`✅ کلمه جستجو روی "**${query}**" تنظیم شد.`, mainMenuKeyboard);
  }

  // ۳. تنظیم کلمات منفی (بخش جدید)
  if (step === "WAITING_FOR_NEGATIVES") {
    const userInput = ctx.message.text;

    // ۱. جدا کردن کلمات بر اساس کاما یا خط تیره
    const rawWords = userInput.split(/[,،-]/);

    // ۲. پاک‌سازی هر کلمه از کاراکترهای خاص
    const cleanWords = rawWords
      .map((word) => {
        // حذف هر چیزی که حرف (فارسی/انگلیسی) یا عدد نیست
        // این Regex کاراکترهای خاص مثل !@#$%^&*()_+ و غیره را حذف می‌کند
        return word.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, "").trim();
      })
      .filter((word) => word.length > 1); // حذف کلمات تک حرفی یا خالی شده

    if (cleanWords.length > 0) {
      await User.updateOne(
        { chatId },
        {
          "filters.negativeWords": cleanWords,
          state: "IDLE",
        },
      );

      const successMsg = `✅ کلمات منفی با موفقیت (پس از پاک‌سازی کاراکترهای خاص) ثبت شدند:\n${cleanWords.map((w) => `⛔️ ${w}`).join("\n")}`;
      ctx.reply(successMsg, mainMenuKeyboard);
    } else {
      ctx.reply(
        "❌ کلمات وارد شده نامعتبر هستند. لطفا فقط حروف و اعداد بفرستید:",
        backButton,
      );
    }
  }
});

bot.action("help_center", async (ctx) => {
  try {
    await ctx.editMessageText(MESSAGES.HELP_TEXT, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("💎 مشاهده پلن‌های اشتراک", "buy_sub")],
        [Markup.button.callback("🔙 بازگشت به منو", "main_menu")],
      ]),
    });
  } catch (e) {
    // در صورت بروز ارور Not Modified
    await ctx.answerCbQuery();
  }
});

// ================= موتور جستجوگر =================
async function fetchPhoneNumber(token, authToken) {
  try {
    const contactUrl = `https://api.divar.ir/v8/postcontact/web/contact_info_v2/${token}`;
    const randomUA = randomUseragent.getRandom();

    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://divar.ir",
      Referer: `https://divar.ir/v/${token}`,
      "User-Agent": randomUA,
      "sec-ch-ua":
        '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      Authorization: `Bearer ${authToken}`,
    };

    const payload = {};
    const response = await axios.post(contactUrl, payload, { headers });

    // ==========================================
    // 🔥 تله کپچا: شناسایی شادوبن و کپچای پنهان
    // ==========================================
    if (response.data?.hip_action?.method === "CAPTCHA") {
      console.log(`⚠️ توکن کپچا خورد و سوخت!`);

      // ساخت یک ارور مصنوعی با کد 403 تا سیستم حذف توکن فعال شود
      const captchaError = new Error("CAPTCHA_REQUIRED");
      captchaError.response = { status: 403 };
      throw captchaError; // پرت کردن ارور به سمت اکشن تلگرام
    }

    // بررسی لیست ویجت‌ها در صورتی که کپچا نخورده باشد
    const widgetList = response.data?.widget_list || [];
    const contacts = [];

    for (const widget of widgetList) {
      if (
        widget.widget_type === "UNEXPANDABLE_ROW" &&
        widget.data?.action?.type === "CALL_PHONE"
      ) {
        const title = widget.data.title || "شماره";
        const phone = widget.data.action.payload.phone_number;

        if (phone) {
          contacts.push({ title, phone });
        }
      }
    }

    return contacts.length > 0 ? contacts : null;
  } catch (error) {
    // ارورها (چه واقعی، چه مصنوعی که خودمون ساختیم) به تلگرام فرستاده میشن
    throw error;
  }
}

async function checkDivar() {
  console.log("🔄 اسکن دیوار...");
  for (const cityId of Object.keys(SUPPORTED_CITIES)) {
    const cityInfo = SUPPORTED_CITIES[cityId];

    // ارسال آیدی شهر به صورت آرایه برای دیوار
    const payload = {
      city_ids: [`${cityId}`],
      search_data: {
        form_data: { data: { category: { str: { value: "motorcycles" } } } },
      },
    };
    // const payload = {
    //   city_ids: CITY_ID,
    //   search_data: {
    //     form_data: { data: { category: { str: { value: "cars" } } } },
    //   },
    // };

    const randomUA = randomUseragent.getRandom();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": randomUA,
      Origin: "https://divar.ir",
      Referer: "https://divar.ir/",
      "sec-ch-ua":
        '"Chromium";v="120", "Google Chrome";v="120", "Not=A?Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "x-standard-divar-error": "true",
      // Cookie: "city=shiraz",
    };

    try {
      const response = await axios.post(DIVAR_URL, payload, { headers });
      const widgets = response.data?.list_widgets || [];

      for (const widget of widgets.reverse()) {
        if (widget.widget_type !== "POST_ROW") continue;

        const sortDate = widget.action_log?.server_side_info?.info?.sort_date;
        if (!isAdFromToday(sortDate)) continue;

        const data = widget.data;
        const token = data.action?.payload?.token || data.token;

        // =========================================================
        // ۱. چک کردن تکراری بودن در دیتابیس (جایگزین فایل JSON)
        // =========================================================
        const existingAd = await Ad.findOne({ token }).select("_id").lean();
        if (existingAd) {
          continue; // این آگهی قبلاً در دیتابیس ذخیره شده، پس ردش کن
        }

        // استخراج اطلاعات اولیه
        const title = data.title;
        const priceText = data.middle_description_text || "توافقی";
        const price = parsePriceNew(priceText); // قیمت عددی اولیه
        const district =
          data.action?.payload?.web_info?.district_persian || "نامشخص";
        const mileage = data.top_description_text || "نامشخص";
        const imageUrl = data.image_url;
        const normalizedTitle = normalizeText(title);

        // =========================================================
        // ۲. یافتن کاربران واجد شرایط (قبل از زدن درخواست سنگین)
        // =========================================================
        const eligibleUsers = await User.find({
          isActive: true,
          subscriptionExpiry: { $gt: new Date() },
          "filters.maxPrice": { $gte: price === "توافقی" ? 0 : price },
          "filters.cityId": Number(cityId),
        });

        const matchedUsers = [];
        for (const user of eligibleUsers) {
          const userQuery = user.filters.query;
          if (userQuery && userQuery.trim() !== "") {
            const normalizedQuery = normalizeText(userQuery);
            if (!normalizedTitle.includes(normalizedQuery)) continue;
          }
          matchedUsers.push(user);
        }

        // =========================================================
        // ۳. دریافت جزئیات کامل و ذخیره در دیتابیس
        // =========================================================
        // ما اینجا آگهی را می‌گیریم و در دیتابیس ذخیره می‌کنیم،
        // حتی اگر خریداری نداشت! چرا؟ چون برای محاسبه میانگین قیمت فردا به آن نیاز داریم.

        const fullAdJson = await fetchFullAdDetails(token);

        const randomDelay = Math.floor(Math.random() * 2000) + 1500;
        await new Promise((resolve) => setTimeout(resolve, randomDelay));

        if (!fullAdJson) {
          console.log(`پرش از آگهی ${token} به دلیل دریافت نشدن جزئیات`);
          continue;
        }

        // if (!fullAdJson) continue; // اگر در دریافت خطا داشتیم، برو بعدی

        // استخراج اطلاعات فنی و دقیق برای دیتابیس
        const condition = analyzeCarCondition(fullAdJson);
        const specs = extractCarSpecs(fullAdJson);

        let specsTextForTelegram = "";
        if (specs.extraSpecs && specs.extraSpecs.length > 0) {
          specsTextForTelegram = specs.extraSpecs
            .map((spec) => `▪️ ${spec.title}: ${spec.value}`)
            .join("\n");
        }

        // اگر قیمت دقیق تو JSON نبود، همون قیمت اولیه لیست رو بذار
        const exactPrice = fullAdJson.webengage?.price || price || 0;
        // استخراج کارکرد به صورت عدد
        const exactMileageNum =
          parseInt(
            fullAdJson.seo?.post_seo_schema?.mileageFromOdometer?.value,
          ) || 0;

        // محاسبه میانگین قیمت این ماشین (این تابع حالا از آگهی‌هایی که بالا ذخیره کردیم استفاده می‌کند)
        const avgPrice = await getAveragePriceFromDB(
          specs.brandModel,
          specs.year,
        );

        const priceEval = evaluatePrice(fullAdJson, avgPrice);

        const publishTimeText =
          fullAdJson.sections
            ?.find((s) => s.section_name === "TITLE")
            ?.widgets?.find((w) => w.widget_type === "EXPANDABLE_SECTION")
            ?.data?.widget_list[0]?.data?.text?.split("\n")[0] || "لحظاتی پیش";

        // ==========================================
        // 📍 استخراج توضیحات و نقشه
        // ==========================================

        // ۱. گرفتن متن توضیحات (از SEO دیوار)
        const adDescription =
          fullAdJson.seo?.description || "توضیحاتی درج نشده است.";

        // ۲. پیدا کردن مختصات نقشه (Latitude و Longitude)
        let mapUrl = null;
        const mapSection = fullAdJson.sections?.find(
          (sec) => sec.section_name === "MAP",
        );

        if (mapSection) {
          const mapRow = mapSection.widgets?.find(
            (w) => w.widget_type === "MAP_ROW",
          );
          // اگر فروشنده لوکیشن دقیق ثبت کرده باشد
          if (mapRow && mapRow.data?.location?.exact_data?.point) {
            const lat = mapRow.data.location.exact_data.point.latitude;
            const lng = mapRow.data.location.exact_data.point.longitude;
            // ساخت لینک مستقیم گوگل مپ
            mapUrl = `https://maps.google.com/?q=${lat},${lng}`;
          }
        }

        try {
          // ذخیره آگهی جدید در دیتابیس (MongoDB)
          await Ad.create({
            token: token,
            title: title,
            brandModel: specs.brandModel || normalizedTitle,
            year: parseInt(normalizeYear(specs.year)) || 0,
            price: exactPrice,
            mileage: exactMileageNum,
            district: district,
            businessType: fullAdJson.webengage?.business_type || "unknown",
            description: adDescription, // 👈 متغیر توضیحاتی که استخراج کردیم
            imageUrl: imageUrl,
            tags: condition.tags,
            publishTimeText: publishTimeText,
            city: cityInfo.nameFa,
            cityId: Number(cityId),
            chassisCondition: condition.chassis,
            bodyCondition: condition.body,
            engineCondition: condition.engine,

            // 🔥 اضافه کردن 3 متغیر جدید به دیتابیس
            mapUrl: mapUrl, // لینکی که در مرحله قبل ساختیم
            dealTag: priceEval.tag, // برچسب شکار یا فیک بودن قیمت
            extraSpecs: specs.extraSpecs, // آرایه مشخصات که تابع extractCarSpecs برمی‌گرداند
          });
          // با ذخیره این آگهی، هم جلوی تکرار آن در دفعات بعد گرفته می‌شود،
          // هم در محاسبه میانگین قیمت‌های آینده تاثیر می‌گذارد!
        } catch (dbError) {
          if (dbError.code === 11000) {
            // خطای Duplicate Key: یعنی همزمان یک پروسه دیگر این آگهی را ذخیره کرده
            continue;
          }
          console.error("خطا در ذخیره دیتابیس", dbError.message);
        }

        // =========================================================
        // ۴. بررسی نهایی و ارسال به کاربران
        // =========================================================
        if (matchedUsers.length === 0) continue; // اگر خریداری نداشت، فقط ذخیره‌اش کردیم و تمام.

        // if (!condition.isRecommended) {
        //   console.log(
        //     "رد شد به دلیل مشکل شاسی/بدنه:",
        //     condition.issues.join(", "),
        //   );
        //   continue; // ماشین داغون است، برای کاربر نفرست
        // }

        console.log(`🔍 تحلیل عمیق و ارسال آگهی: ${title}`);

        // اگر قیمت فیک بود، به جای نمایش عدد خنده‌دار (۱۰ هزار تومان)، کلمه مناسب بنویس
        let finalPriceDisplay = priceText; // پیش‌فرض: همون متنی که دیوار داده
        if (priceEval.isFakePrice) {
          // مثلاً به جای نمایش ۱۰۰,۰۰۰ تومان می‌نویسیم:
          finalPriceDisplay = "⚠️ درج شده به عنوان پیش‌پرداخت / غیرواقعی";
        }

        // ۴. ارسال پیام برای کاربرانی که مچ شده‌اند (با اعمال محدودیت‌های اشتراک)
        for (const user of matchedUsers) {
          const userPlan = user.plan || "bronze";

          // ----------------------------------------------------------------
          // محدودیت اول: فیلتر کلمات منفی (مخصوص نقره‌ای و طلایی)
          // ----------------------------------------------------------------
          if (userPlan === "silver" || userPlan === "gold") {
            const negativeWords = user.filters.negativeWords || [];
            // اگر یکی از کلمات منفی کاربر در توضیحات آگهی بود، برای این کاربر نفرست!
            const hasNegativeWord = negativeWords.some(
              (word) =>
                fullAdJson.seo?.description?.includes(word) ||
                title.includes(word),
            );
            if (hasNegativeWord) {
              continue; // پرش به کاربر بعدی
            }
          }

          // ----------------------------------------------------------------
          // محدودیت دوم: مخفی کردن لیبل‌ها و لینک‌ها برای کاربران برنزی (وسوسه کردن)
          // ----------------------------------------------------------------
          let displayTags = [...condition.tags]; // کپی از تگ‌های اصلی
          let displayPriceTag = priceEval.tag;
          let finalToken = token;
          let finalImageUrl = imageUrl;

          // اگر ماشین واقعاً شکار بود (زیر قیمت بازار)
          if (priceEval.isGoodDeal) {
            if (userPlan === "bronze" || userPlan === "silver") {
              // کاربران عادی حق دیدن ماشین شکار را ندارند!
              // به جای ارسال لینک، یک پیام وسوسه‌کننده می‌فرستیم:
              displayPriceTag = "🔒 شکار ویژه روز (مخصوص کاربران VIP)";
              displayTags = [
                "برای مشاهده جزئیات این آگهی رانتی، اشتراک خود را طلایی کنید.",
              ];
              finalToken = "UPGRADE_REQUIRED"; // این باعث میشه لینک دیوار کار نکنه
              finalImageUrl = "https://yoursite.com/blurred-car-image.jpg"; // یک عکس تار شده
            }
            // کاربر طلایی همه چیز را کامل و بدون سانسور می‌بیند
          } else {
            // اگر ماشین عادی بود، کاربران برنزی تگ تشخیص دلال را نمی‌بینند
            if (userPlan === "bronze") {
              displayTags = displayTags.filter(
                (tag) => !tag.includes("دلال") && !tag.includes("مصرف‌کننده"),
              );
            }
          }

          // فقط کافیست تگ‌ها را مستقیماً به تابع پاس بدهید تا خودش ظاهر پیام را بسازد
          await sendTelegramAlert(
            user.chatId,
            title,
            finalPriceDisplay,
            district,
            mileage,
            finalToken, // 👈 تغییر کرد: ارسال توکن قفل‌شده برای کاربران عادی
            finalImageUrl, // 👈 تغییر کرد: ارسال عکس تار شده برای کاربران عادی
            displayTags, // 👈 تغییر کرد: ارسال تگ‌های فیلتر شده (حذف تگ دلال برای برنزی)
            displayPriceTag, // 👈 تغییر کرد: ارسال تگ قفل‌شده (شکار ویژه)
            user.plan,
            publishTimeText,
            specsTextForTelegram, // این را در مرحله قبل اضافه کردیم
            adDescription, // 👈 پارامتر جدید توضیحات
            mapUrl,
            cityInfo.nameFa,
            specs.year,
          );
        }
      }
    } catch (error) {
      if (error.response && error.response.status === 403) {
        console.error("⛔ Access Denied (403)");
      } else {
        console.error("❌ Error:", error.message);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function sendTelegramAlert(
  targetChatId,
  title,
  priceText,
  district,
  mileage,
  token,
  imageUrl,
  tags = [], // آرایه تگ‌ها: ["✅ شاسی پلمپ", "👤 مصرف‌کننده"]
  dealTag = "", // تگ قیمت: "🔥 شکار روز (۱۵٪ زیر فی)"
  userPlan = "bronze",
  publishTimeText,
  extraSpecsText, // 👈 لیست مشخصات استخراج شده از لیست دیتا
  description, // 👈 توضیحات متنی آگهی
  mapUrl, // 👈 لینک مختصات گوگل مپ
  cityName,
  year,
) {
  // ساختاربندی متن پیام با HTML
  let caption = "";

  // ۱. اگر آگهی شکار بود، آژیر را بالای پیام نشان بده
  if (dealTag) {
    caption += `🚨 <b>${dealTag}</b>\n\n`;
  }

  // ۲. اطلاعات اصلی آگهی
  caption += `🚗 <b>${title}</b>\n\n`;
  caption += `💰 قیمت: <code>${priceText}</code>\n`;
  caption += `📟 کارکرد: ${mileage}\n`;
  caption += `📅 مدل (سال تولید): ${year}\n`;
  caption += `🏙 شهر: ${cityName}\n`;
  caption += `📍 محدوده: ${district}\n`;
  caption += `🕒 ${publishTimeText}\n`;

  // ۳. وضعیت فنی و بدنه (تگ‌های هوشمند)
  if (tags && tags.length > 0) {
    caption += `\n🛠 <b>وضعیت بررسی شده:</b>\n`;
    caption += `▫️ ${tags.join(" | ")}\n`;
  }

  // ۴. مشخصات تکمیلی (بیمه، گیربکس، سوخت و...)
  if (extraSpecsText) {
    caption += `\n📋 <b>مشخصات فنی:</b>\n${extraSpecsText}\n`;
  }

  // ۵. توضیحات فروشنده (با برش ایمن برای جلوگیری از خطای لیمیت 1024 کاراکتر تلگرام)
  if (description) {
    const safeDescription =
      description.length > 300
        ? description.substring(0, 300) + "... (ادامه در دیوار)"
        : description;
    caption += `\n📝 <b>توضیحات:</b>\n<i>${safeDescription}</i>\n`;
  }

  // ==========================================
  // 🔘 ساخت دکمه‌های شیشه‌ای
  // ==========================================
  const link = `https://divar.ir/v/${token}`;
  let keyboard;

  if (token === "UPGRADE_REQUIRED") {
    // برای آگهی‌های شکار که کلاً قفل هستند
    keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "💎 ارتقا به حساب طلایی برای مشاهده",
          "buy_sub_gold",
        ),
      ],
    ]);
  } else {
    // ردیف اول: دکمه لینک دیوار برای همه باز است
    const mainButtons = [Markup.button.url("🔗 مشاهده در دیوار", link)];

    // ردیف دوم: منطق شرطی برای دکمه شماره تماس
    const secondRow =
      userPlan === "gold"
        ? [Markup.button.callback("📞 دریافت شماره تماس", `get_phone_${token}`)]
        : [
            Markup.button.callback(
              "🔒 دریافت شماره (مخصوص طلایی)",
              "upgrade_to_gold_alert",
            ),
          ];

    const buttonsArray = [mainButtons, secondRow];

    // ردیف سوم: دکمه نقشه (فقط اگر لوکیشن وجود داشت اضافه می‌شود)
    if (mapUrl) {
      buttonsArray.push([Markup.button.url("🗺 مسیریابی روی نقشه", mapUrl)]);
    }

    keyboard = Markup.inlineKeyboard(buttonsArray);
  }

  // ==========================================
  // 🚀 ارسال پیام به کاربر
  // ==========================================
  try {
    if (imageUrl) {
      await bot.telegram.sendPhoto(targetChatId, imageUrl, {
        caption: caption,
        parse_mode: "HTML",
        ...keyboard,
      });
    } else {
      await bot.telegram.sendMessage(targetChatId, caption, {
        parse_mode: "HTML",
        ...keyboard,
        disable_web_page_preview: true, // برای جلوگیری از به هم ریختگی پیام‌های بدون عکس
      });
    }
  } catch (e) {
    // مدیریت ارورهای تلگرام (بلاک شدن ربات توسط کاربر)
    if (e.response && e.response.error_code === 403) {
      console.log(`⛔ User ${targetChatId} blocked the bot. Disabling...`);
      // آپدیت دیتابیس برای جلوگیری از ارسال‌های بیهوده بعدی
      await User.updateOne({ chatId: targetChatId }, { isActive: false });
    } else {
      console.error(`Telegram Error for ${targetChatId}:`, e.message);
    }
  }
}

// اجرا
console.log("🤖 Bot is Run...");
checkDivar();
setInterval(checkDivar, CHECK_INTERVAL * 1000);

bot
  .launch({ dropPendingUpdates: true })
  .then(() => console.log("✅ ربات با موفقیت استارت شد"))
  .catch((err) => console.error("❌ خطا در استارت ربات:", err));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
