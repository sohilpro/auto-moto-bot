require("dotenv").config();
const { Scenes, Markup } = require("telegraf");
const User = require("../models/User"); // فرض بر این است که مدل کاربر را دارید

const { saveTokens, getTokens } = require("../bot/utils/tokenManager");

// ۱. ساخت صحنه ادمین برای دریافت توکن
const tokenManageScene = new Scenes.WizardScene(
  "TOKEN_MANAGE_SCENE",
  async (ctx) => {
    const currentTokens = getTokens();
    await ctx.reply(
      `🔑 **مدیریت توکن‌های دیوار**\n\nتعداد توکن‌های فعلی: ${currentTokens.length}\n\nلطفاً توکن‌های جدید را بفرستید. (اگر چند توکن است، آن‌ها را با خطِ جدید (Enter) از هم جدا کنید):\n\nبرای لغو /cancel را بزنید.`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === "/cancel") {
      await ctx.reply("❌ عملیات لغو شد.");
      return ctx.scene.leave();
    }

    // گرفتن متن و جدا کردن توکن‌ها با اینتر
    const input = ctx.message.text;
    const newTokens = input
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length > 10);

    if (newTokens.length === 0) {
      await ctx.reply("❌ هیچ توکن معتبری یافت نشد. لغو عملیات.");
      return ctx.scene.leave();
    }

    // جایگزین کردن توکن‌ها در فایل
    saveTokens(newTokens);

    await ctx.reply(
      `✅ با موفقیت ذخیره شد!\nتعداد ${newTokens.length} توکن جدید جایگزین توکن‌های قبلی گردید.`,
    );
    return ctx.scene.leave();
  },
);

const userManageScene = new Scenes.WizardScene(
  "USER_MANAGE_SCENE",
  async (ctx) => {
    await ctx.reply("🆔 لطفاً آیدی عددی کاربر مورد نظر را بفرستید:");
    return ctx.wizard.next();
  },
  async (ctx) => {
    const targetId = ctx.message.text;
    const user = await User.findOne({ chatId: targetId });

    if (!user) {
      await ctx.reply("❌ کاربر یافت نشد.");
      return ctx.scene.leave();
    }

    ctx.wizard.state.targetUser = user;
    await ctx.reply(
      `👤 **اطلاعات کاربر:**\nنام: ${user.firstName}\nپلن: ${user.plan}\nوضعیت: ${user.isActive ? "✅" : "🚫"}\nانقضا: ${user.subscriptionExpiry.toLocaleDateString("fa-IR")}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ ۷ روز هدیه", `gift_7_${targetId}`)],
        [
          Markup.button.callback(
            user.isActive ? "🚫 بلاک کردن" : "✅ آنبلاک",
            `toggle_block_${targetId}`,
          ),
        ],
        [Markup.button.callback("❌ خروج", "admin_back")],
      ]),
    );
    return ctx.scene.leave();
  },
);

const broadcastScene = new Scenes.WizardScene(
  "BROADCAST_SCENE",
  async (ctx) => {
    // گرفتن نوع فیلتر از مرحله قبل (همه، طلایی یا رایگان)
    const target = ctx.scene.state.target || "all";
    let targetText = "همه کاربران";
    if (target === "gold") targetText = "کاربران طلایی";
    if (target === "silver") targetText = "کاربران نقره ایی";
    if (target === "bronze") targetText = "کاربران برنزی";

    await ctx.reply(
      `📣 در حال آماده‌سازی ارسال برای: ${targetText}\n\nلطفاً پیام خود را (متن، عکس یا...) ارسال کنید یا برای لغو /cancel را بزنید:`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === "/cancel") {
      await ctx.reply("❌ ارسال لغو شد.");
      return ctx.scene.leave();
    }

    const target = ctx.scene.state.target || "all";
    let query = {};
    if (target === "gold") query = { plan: "gold" };
    if (target === "silver") query = { plan: "silver" };
    if (target === "bronze") query = { plan: "bronze" };

    const users = await User.find(query);
    let success = 0;
    let failed = 0;

    await ctx.reply(`⏳ شروع ارسال به ${users.length} نفر...`);

    for (const user of users) {
      try {
        // استفاده از copyMessage برای حفظ فرمت (عکس، کپشن و غیره)
        await ctx.telegram.copyMessage(
          user.chatId,
          ctx.from.id,
          ctx.message.message_id,
        );
        success++;
        // تاخیر برای جلوگیری از اسپم شناخته شدن توسط تلگرام
        await new Promise((r) => setTimeout(r, 50));
      } catch (e) {
        failed++;
      }
    }

    await ctx.reply(
      `✅ **گزارش ارسال نهایی:**\n\n🟢 موفق: ${success}\n🔴 ناموفق: ${failed}`,
    );
    return ctx.scene.leave();
  },
);

const setupAdmin = (bot) => {
  const ADMIN_ID = Number(process.env.ADMIN_ID);

  const adminMenu = (ctx) => {
    return ctx.reply(
      "🏁 **پنل مدیریت اتوآنالیز**\nلطفاً یک گزینه را انتخاب کنید:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("📊 آمار کلی", "admin_stats"),
          Markup.button.callback("📢 اطلاع‌رسانی", "admin_broadcast_menu"),
        ],
        [
          Markup.button.callback("🔍 جستجوی کاربر", "admin_search_user"),
          Markup.button.callback("🚫 بلاک/آنبلاک", "admin_block_user"),
        ],
        [Markup.button.callback("💎 مدیریت اشتراک", "admin_manage_sub")],
        [Markup.button.callback("🔑 مدیریت توکن‌ها", "admin_manage_tokens")],
      ]),
    );
  };

  // دستور ورود به پنل
  bot.command("admin", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    return adminMenu(ctx);
  });

  // ۱. آمار کلی
  // استفاده از Regex برای گرفتن شماره صفحه (مثلا admin_stats_1, admin_stats_2)
  bot.action(/admin_stats(?:_(\d+))?/, async (ctx) => {
    // گرفتن شماره صفحه از دکمه (اگر نبود، صفحه ۱ در نظر گرفته میشه)
    const page = parseInt(ctx.match[1]) || 1;
    const limit = 5; // تعداد کاربر در هر صفحه
    const skip = (page - 1) * limit;

    // ۱. محاسبات دقیق آمار دیتابیس
    const total = await User.countDocuments();
    const active = await User.countDocuments({ isActive: true });
    const blocked = total - active;

    const gold = await User.countDocuments({
      plan: "gold",
      subscriptionExpiry: { $gt: new Date() },
    });
    const silver = await User.countDocuments({
      plan: "silver",
      subscriptionExpiry: { $gt: new Date() },
    });
    const bronze = total - (gold + silver);

    // محاسبه تعداد کل صفحات
    const totalPages = Math.ceil(total / limit) || 1;

    // ۲. گرفتن کاربرانِ مخصوص همین صفحه (با استفاده از skip و limit)
    const usersOnThisPage = await User.find()
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);

    const buttons = [];

    // ردیف اول: آمار اعضا
    buttons.push([
      Markup.button.callback(`👥 کل: ${total}`, "dummy"),
      Markup.button.callback(`✅ فعال: ${active}`, "dummy"),
      Markup.button.callback(`🚫 بلاک: ${blocked}`, "dummy"),
    ]);

    // ردیف دوم: آمار اشتراک‌ها
    buttons.push([
      Markup.button.callback(`👑 طلایی: ${gold}`, "dummy"),
      Markup.button.callback(`⚪️ نقره‌ای: ${silver}`, "dummy"),
      Markup.button.callback(`🟤 برنزی: ${bronze}`, "dummy"),
    ]);

    // ردیف جداکننده
    buttons.push([
      Markup.button.callback(
        `🔻 لیست کاربران (صفحه ${page} از ${totalPages}) 🔻`,
        "dummy",
      ),
    ]);

    usersOnThisPage.forEach((user) => {
      // متن پیش‌فرض برای وقتی که کاربر اصلاً تاریخ انقضا در دیتابیس ندارد
      let timeText = "نامشخص";

      // شرط محدودکننده برنزی حذف شد. حالا هر کاربری تاریخ انقضا داشته باشد محاسبه می‌شود.
      if (user.subscriptionExpiry) {
        const diff = new Date(user.subscriptionExpiry) - new Date();
        if (diff > 0) {
          timeText = `${Math.ceil(diff / (1000 * 60 * 60 * 24))} روز`;
        } else {
          timeText = "منقضی";
        }
      }

      const planIcon =
        user.plan === "gold" ? "🥇" : user.plan === "silver" ? "🥈" : "🥉";
      const activeIcon = user.isActive ? "✅" : "🚫";
      const name = user.chatId || "کاربر";

      const btnText = `${planIcon} ${name} | ${activeIcon} | ⏳ ${timeText}`;

      buttons.push([
        Markup.button.callback(btnText, `admin_manage_${user.chatId}`),
      ]);
    });

    // ۴. دکمه‌های صفحه‌بندی (قبلی / بعدی)
    const paginationRow = [];
    if (page > 1) {
      // اگر صفحه ۱ نیستیم، دکمه قبلی رو نشون بده
      paginationRow.push(
        Markup.button.callback("◀️ صفحه قبل", `admin_stats_${page - 1}`),
      );
    }

    // دکمه وسط برای نمایش شماره صفحه
    paginationRow.push(
      Markup.button.callback(`📄 ${page}/${totalPages}`, "dummy"),
    );

    if (page < totalPages) {
      // اگر به صفحه آخر نرسیدیم، دکمه بعدی رو نشون بده
      paginationRow.push(
        Markup.button.callback("صفحه بعد ▶️", `admin_stats_${page + 1}`),
      );
    }

    buttons.push(paginationRow);

    // ۵. دکمه‌های بروزرسانی و بازگشت
    buttons.push([
      Markup.button.callback("🔄 بروزرسانی این صفحه", `admin_stats_${page}`),
      Markup.button.callback("🔙 بازگشت به منو", "admin_back"),
    ]);

    const text = `📊 **داشبورد حرفه‌ای اتوآنالیز**\n\nبرای مدیریت سریعِ هر کاربر، مستقیماً روی نام او کلیک کنید:`;

    await ctx
      .editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      })
      .catch(() => ctx.answerCbQuery("آمار کاملاً بروز است!"));
  });

  // ۲. منوی اطلاع‌رسانی و ورود به صحنه
  bot.action("admin_broadcast_menu", (ctx) => {
    ctx.editMessageText(
      "📢 نوع مخاطب را انتخاب کنید:",
      Markup.inlineKeyboard([
        [Markup.button.callback("🌍 همه", "bc_all")],
        [
          Markup.button.callback("🥉 برنزی", "bc_bronze"),
          Markup.button.callback("🥈 نقره ای", "bc_silver"),
          Markup.button.callback("🥇 طلایی", "bc_gold"),
        ],
        [Markup.button.callback("🔙 بازگشت", "admin_back")],
      ]),
    );
  });

  bot.action("bc_all", (ctx) =>
    ctx.scene.enter("BROADCAST_SCENE", { target: "all" }),
  );
  bot.action("bc_bronze", (ctx) =>
    ctx.scene.enter("BROADCAST_SCENE", { target: "bronze" }),
  );
  bot.action("bc_silver", (ctx) =>
    ctx.scene.enter("BROADCAST_SCENE", { target: "silver" }),
  );
  bot.action("bc_gold", (ctx) =>
    ctx.scene.enter("BROADCAST_SCENE", { target: "gold" }),
  );

  // ۳. مدیریت کاربر (ورود به صحنه جستجو)
  bot.action("admin_search_user", (ctx) => {
    return ctx.scene.enter("USER_MANAGE_SCENE");
  });

  // هدیه دادن ۷ روز
  bot.action(/gift_7_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const user = await User.findOne({ chatId: targetId });

    // اگر از قبل اشتراک داشت، ۷ روز می‌ره روی همون، در غیر این صورت از الان حساب میشه
    let baseDate =
      user.subscriptionExpiry && user.subscriptionExpiry > new Date()
        ? new Date(user.subscriptionExpiry)
        : new Date();

    baseDate.setDate(baseDate.getDate() + 7);

    // آپدیت دیتابیس
    await User.updateOne(
      { chatId: targetId },
      {
        subscriptionExpiry: baseDate,
        plan: "gold",
      },
    );

    await ctx.answerCbQuery("✅ ۷ روز اشتراک اضافه شد.");

    // 🔥 اینجا پیام قبلی رو با دیتای جدید بروزرسانی می‌کنیم 🔥
    await renderQuickManagePanel(ctx, targetId);

    // ارسال پیام به خود کاربر (اختیاری)
    ctx.telegram
      .sendMessage(
        targetId,
        "🎁 تبریک! ادمین به شما ۷ روز اشتراک طلایی هدیه داد.",
      )
      .catch(() => {});
  });

  // بلاک و آنبلاک
  bot.action(/toggle_block_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const user = await User.findOne({ chatId: targetId });

    // تغییر وضعیت در دیتابیس
    await User.updateOne({ chatId: targetId }, { isActive: !user.isActive });

    await ctx.answerCbQuery(
      user.isActive ? "🚫 کاربر بلاک شد." : "✅ کاربر آنبلاک شد.",
    );

    // 🔥 اینجا دکمه بلاک/آنبلاک و وضعیت بالای پیام درجا تغییر می‌کنه 🔥
    await renderQuickManagePanel(ctx, targetId);
  });

  bot.action("admin_back", (ctx) => adminMenu(ctx));

  // ۱. نمایش لیست کاربران با صفحه‌بندی برای مدیریت اشتراک
  bot.action(/admin_manage_sub(?:_(\d+))?/, async (ctx) => {
    try {
      const page = parseInt(ctx.match[1]) || 1;
      const limit = 5;
      const skip = (page - 1) * limit;

      const total = await User.countDocuments();
      const totalPages = Math.ceil(total / limit) || 1;

      const users = await User.find().sort({ _id: -1 }).skip(skip).limit(limit);

      const buttons = [];

      // دکمه‌های مربوط به هر کاربر
      users.forEach((user) => {
        let planFa =
          user.plan === "gold" ? "🥇" : user.plan === "silver" ? "🥈" : "🥉";

        // نام کاربر (کمی کوتاه‌تر می‌کنیم تا جا برای آیدی باز شود)
        const name = (user.firstName || "کاربر").substring(0, 12);

        // اگر یوزرنیم داشت با @ نشان بده، وگرنه آیدی عددی را بگذار
        const identifier = user.username ? `@${user.username}` : user.chatId;

        buttons.push([
          Markup.button.callback(
            `${planFa} ${name} | ${identifier}`,
            `admin_sub_user_${user.chatId}`,
          ),
        ]);
      });

      // دکمه‌های صفحه‌بندی
      const paginationRow = [];
      if (page > 1)
        paginationRow.push(
          Markup.button.callback("◀️ قبلی", `admin_manage_sub_${page - 1}`),
        );
      paginationRow.push(
        Markup.button.callback(`📄 ${page}/${totalPages}`, "dummy"),
      );
      if (page < totalPages)
        paginationRow.push(
          Markup.button.callback("بعدی ▶️", `admin_manage_sub_${page + 1}`),
        );

      buttons.push(paginationRow);
      buttons.push([
        Markup.button.callback("🔙 بازگشت به منوی اصلی", "admin_back"),
      ]);

      await ctx.editMessageText(
        "💎 **بخش مدیریت اشتراک کاربران**\n\nروی کاربر مورد نظر کلیک کنید:",
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        },
      );
    } catch (e) {
      console.error(e);
      ctx
        .answerCbQuery("❌ خطایی رخ داد.", { show_alert: true })
        .catch(() => {});
    }
  });

  // تابع کمکی برای ساخت منوی کاربر (چون بعد از هر تغییر باید پیام آپدیت شود)
  async function renderUserSubPanel(ctx, targetId) {
    const user = await User.findOne({ chatId: targetId });
    if (!user)
      return ctx.answerCbQuery("❌ کاربر یافت نشد!", { show_alert: true });

    let daysLeft = 0;
    let timeText = "ندارد (رایگان)";

    // محاسبه روزهای باقیمانده
    if (user.subscriptionExpiry) {
      const diff = new Date(user.subscriptionExpiry) - new Date();
      if (diff > 0) {
        daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
        timeText = `${daysLeft} روز`;
      } else {
        timeText = "منقضی شده";
      }
    }

    const planFa =
      user.plan === "gold"
        ? "👑 طلایی"
        : user.plan === "silver"
          ? "⚪️ نقره‌ای"
          : "🟤 برنزی";

    const text = `👤 **کاربر:** ${user.chatId || "نامشخص"} (<code>${user.chatId}</code>)
🎖 **پلن فعلی:** ${planFa}
⏳ **اعتبار باقیمانده:** ${timeText}

👇 *برای اعمال تغییرات از دکمه‌های زیر استفاده کنید:*`;

    const buttons = [
      // ردیف کم و زیاد کردن روزها
      [
        Markup.button.callback("➕ ۱ روز", `sub_add1_${targetId}`),
        Markup.button.callback("➖ ۱ روز", `sub_sub1_${targetId}`),
      ],
      // ردیف تمدید فیکس ۳۰ روزه
      [
        Markup.button.callback(
          "🔄 تمدید فیکس ۳۰ روزه",
          `sub_renew30_${targetId}`,
        ),
      ],
      // ردیف تغییر پلن
      [
        Markup.button.callback("👑 طلایی", `sub_plan_gold_${targetId}`),
        Markup.button.callback("⚪️ نقره‌ای", `sub_plan_silver_${targetId}`),
        Markup.button.callback("🟤 برنزی", `sub_plan_bronze_${targetId}`),
      ],
      // بازگشت به لیست
      [Markup.button.callback("🔙 بازگشت به لیست", "admin_manage_sub_1")],
    ];

    await ctx
      .editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
      })
      .catch(() => {}); // نادیده گرفتن ارور تکراری بودن پیام
  }

  // ورود به پنل کاربر
  bot.action(/admin_sub_user_(\d+)/, async (ctx) => {
    await renderUserSubPanel(ctx, ctx.match[1]);
  });

  // افزایش ۱ روز
  bot.action(/sub_add1_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const user = await User.findOne({ chatId: targetId });

    // اگر اشتراک قبلی گذشته بود، از همین الان محاسبه کن
    let baseDate =
      user.subscriptionExpiry && user.subscriptionExpiry > new Date()
        ? new Date(user.subscriptionExpiry)
        : new Date();

    baseDate.setDate(baseDate.getDate() + 1);
    await User.updateOne(
      { chatId: targetId },
      { subscriptionExpiry: baseDate },
    );

    await ctx.answerCbQuery("✅ ۱ روز اضافه شد.");
    await renderUserSubPanel(ctx, targetId); // آپدیت پنل
  });

  // کاهش ۱ روز
  bot.action(/sub_sub1_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    const user = await User.findOne({ chatId: targetId });

    if (user.subscriptionExpiry && user.subscriptionExpiry > new Date()) {
      let baseDate = new Date(user.subscriptionExpiry);
      baseDate.setDate(baseDate.getDate() - 1);
      await User.updateOne(
        { chatId: targetId },
        { subscriptionExpiry: baseDate },
      );
      await ctx.answerCbQuery("✅ ۱ روز کم شد.");
    } else {
      await ctx.answerCbQuery("❌ اشتراکی ندارد که کم شود!", {
        show_alert: true,
      });
    }
    await renderUserSubPanel(ctx, targetId);
  });

  // تمدید فیکس ۳۰ روزه (از لحظه کلیک)
  bot.action(/sub_renew30_(\d+)/, async (ctx) => {
    const targetId = ctx.match[1];
    let newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 30); // 30 روز از همین الان

    await User.updateOne(
      { chatId: targetId },
      { subscriptionExpiry: newExpiry },
    );
    await ctx.answerCbQuery("✅ اشتراک به مدت ۳۰ روز شارژ شد.");
    await renderUserSubPanel(ctx, targetId);
  });

  // تغییر پلن (طلایی، نقره‌ای، برنزی)
  bot.action(/sub_plan_(gold|silver|bronze)_(\d+)/, async (ctx) => {
    const newPlan = ctx.match[1];
    const targetId = ctx.match[2];

    let updateData = { plan: newPlan };
    // اگر برنزی شد، اشتراکش رو هم میشه صفر کرد (اختیاری)
    if (newPlan === "bronze") {
      updateData.subscriptionExpiry = new Date(); // منقضی در همین لحظه
    }

    await User.updateOne({ chatId: targetId }, updateData);

    const planNames = { gold: "طلایی", silver: "نقره‌ای", bronze: "برنزی" };
    await ctx.answerCbQuery(
      `✅ پلن کاربر به ${planNames[newPlan]} تغییر یافت.`,
      { show_alert: true },
    );
    await renderUserSubPanel(ctx, targetId);
  });

  // اکشن کلیک مستقیم روی لیست کاربران
  // ==========================================
  // ۱. تابع آپدیت زنده برای پنل مدیریت سریع
  // ==========================================
  async function renderQuickManagePanel(ctx, targetId) {
    const user = await User.findOne({ chatId: targetId });

    if (!user) {
      return ctx
        .answerCbQuery("❌ کاربر در دیتابیس یافت نشد!", { show_alert: true })
        .catch(() => {});
    }

    let timeText = "ندارد (رایگان)";
    if (user.plan !== "bronze" && user.subscriptionExpiry) {
      const diff = new Date(user.subscriptionExpiry) - new Date();
      timeText =
        diff > 0
          ? `${Math.ceil(diff / (1000 * 60 * 60 * 24))} روز`
          : "منقضی شده";
    }

    const text = `👤 **مدیریت سریع کاربر:**\n\nکاربر: ${user.chatId || "نامشخص"}\nآیدی: <code>${user.chatId}</code>\nپلن: ${user.plan === "gold" ? "👑 طلایی" : "🟤 برنزی"}\nوضعیت: ${user.isActive ? "✅ فعال" : "🚫 بلاک شده"}\nاعتبار: ${timeText}`;

    const buttons = [
      [Markup.button.callback("➕ ۷ روز هدیه طلایی", `gift_7_${targetId}`)],
      [
        Markup.button.callback(
          user.isActive ? "🚫 بلاک کردن" : "✅ آنبلاک",
          `toggle_block_${targetId}`,
        ),
      ],
      [Markup.button.callback("🔙 بازگشت به داشبورد", "admin_stats")],
    ];

    try {
      // ویرایش پیام فعلی با اطلاعات تازه
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (e) {
      // نادیده گرفتن ارور در صورتی که دکمه تکراری فشرده شود
    }
  }

  // ==========================================
  // ۲. اکشن ورود به پنل از طریق لیست داشبورد
  // ==========================================
  bot.action(/admin_manage_(\d+)/, async (ctx) => {
    await renderQuickManagePanel(ctx, ctx.match[1]);
  });

  // ۳. اکشنِ ورود به صحنه توکن
  bot.action("admin_manage_tokens", (ctx) => {
    return ctx.scene.enter("TOKEN_MANAGE_SCENE");
  });
};

module.exports = {
  setupAdmin,
  userManageScene,
  broadcastScene,
  tokenManageScene,
};
