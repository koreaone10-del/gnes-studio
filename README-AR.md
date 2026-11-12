# Agnes Studio — إصلاح وتطوير v1.1.0

## ما الذي تم إصلاحه؟
- إصلاح جذري لخطأ `Invalid asset path 'data:image/...;base64,...'` في Magic Hour.
- رفع الصورة عبر `POST /v1/files/upload-urls` ثم `PUT` للبايتات الخام إلى رابط الرفع الموقّع، وبعدها إرسال `file_path` إلى `/v1/image-to-video`.
- تغيير دقة Magic Hour إلى `480p` لتجنب خطأ `plan_upgrade_required` الذي ظهر عند طلب `720p`.
- استخدام النموذج الموثق `ltx-2.5` بدلاً من `ltx-2.3`.
- منع تسجيل استجابات ضخمة تحتوي على Base64 في Render Logs.
- رسائل أوضح عند نفاد الرصيد أو بلوغ حد Agnes المجاني.
- واجهة عربية RTL جديدة، متجاوبة مع الهاتف، مع معاينة ورفع ملفات وشريط تقدم.

## الملفات
- `server/index.js`
- `public/index.html`
- `public/style.css`
- `public/app.js`
- `package.json`

## متغيرات Render المطلوبة
- `AGNES_API_KEY`
- `MAGIC_HOUR_API_KEY`

لا تضع المفاتيح داخل ملفات GitHub. أضفها في Render → Environment.

## إعداد Render
Build Command: `npm install`
Start Command: `npm start`

بعد رفع الملفات إلى الفرع `main` انتظر اكتمال Deploy ثم افتح:
`https://gnes-studio.onrender.com/api/health`

يجب أن يظهر `status: ok` وأن تظهر حالة المفاتيح في `providers`.

## ملاحظات مهمة عن الرصيد
السجلات المرفقة تثبت أن Agnes أعاد:
- `insufficient_user_quota` مع رصيد `$0.000000`
- `rate_limit_exceeded`

هذه ليست أخطاء برمجية؛ لا يستطيع أي تعديل في الموقع إعادة رصيد المزود. عند فشل Agnes يحاول النظام Magic Hour تلقائياً. كما أن نجاح إنشاء المشروع يعتمد على وجود رصيد/إتاحة كافية في حساب Magic Hour.

## حدود معروفة
- مهام الفيديو محفوظة في ذاكرة عملية الخادم؛ إذا أعاد Render تشغيل الخدمة أثناء المعالجة فقد تحتاج لبدء الطلب من جديد.
- لا يمكن ضمان مدة 15 أو 30 ثانية لكل نموذج/خطة؛ قبول المدة يحدده مزود الخدمة.
- لا تشارك مفاتيح API في المحادثة أو داخل المستودع.
