require('dotenv').config();

const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

const AGNES_API_KEY = process.env.AGNES_API_KEY || '';
const MAGIC_HOUR_API_KEY = process.env.MAGIC_HOUR_API_KEY || '';
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const MAGIC_HOUR_BASE_URL = 'https://api.magichour.ai/v1';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1h' }));

const agnesClient = AGNES_API_KEY ? axios.create({
  baseURL: AGNES_BASE_URL,
  headers: { Authorization: `Bearer ${AGNES_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 120000
}) : null;

const magicClient = MAGIC_HOUR_API_KEY ? axios.create({
  baseURL: MAGIC_HOUR_BASE_URL,
  headers: { Authorization: `Bearer ${MAGIC_HOUR_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 120000
}) : null;

// Jobs are kept in memory for this single-instance Render service.
const tasks = new Map();

function safeProviderError(error) {
  const data = error?.response?.data;
  if (data && typeof data === 'object') {
    const message = data.message || data.error?.message || data.code || 'Provider rejected the request.';
    return {
      code: data.code || data.error?.code || data.error?.type || 'provider_error',
      message: String(message).slice(0, 700),
      status: error.response?.status || null
    };
  }
  return {
    code: 'network_error',
    message: String(error?.message || 'Network request failed.').slice(0, 400),
    status: error?.response?.status || null
  };
}

function publicError(error) {
  const e = safeProviderError(error);
  if (e.code === 'insufficient_user_quota' || e.code === 'insufficient_credits') {
    return 'رصيد هذا المزود غير كافٍ حالياً. أضف رصيداً أو استخدم مزوداً لديه رصيد متاح.';
  }
  if (e.code === 'rate_limit_exceeded') {
    return 'تم بلوغ حد الطلبات المجانية لدى Agnes AI. انتظر تجدد الحد أو استخدم المزود البديل.';
  }
  if (e.code === 'plan_upgrade_required') {
    return 'الدقة المطلوبة غير متاحة في خطة Magic Hour الحالية. تم ضبط المنصة على 480p لتوافق الخطط الأساسية.';
  }
  if (e.code === 'unprocessable_entity' && /asset path/i.test(e.message)) {
    return 'رفض Magic Hour ملف الصورة. تم إصلاح طريقة الرفع في هذا الإصدار؛ تأكد من نشر آخر نسخة.';
  }
  return e.message;
}

function extensionFor(file) {
  const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
  const allowed = ['jpg', 'jpeg', 'png', 'webp'];
  if (allowed.includes(ext)) return ext === 'jpg' ? 'jpeg' : ext;
  const byMime = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  return byMime[file.mimetype] || null;
}

/**
 * Magic Hour does NOT accept data:image/...;base64,... in image_file_path.
 * Correct flow: request a signed upload URL, PUT raw binary bytes to it,
 * then pass the returned api-assets/... file_path to image-to-video.
 */
async function uploadImageToMagicHour(file) {
  if (!magicClient) throw new Error('مفتاح MAGIC_HOUR_API_KEY غير مضبوط على Render.');

  const extension = extensionFor(file);
  if (!extension) throw new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP.');

  const ticket = await magicClient.post('/files/upload-urls', {
    items: [{ type: 'image', extension }]
  });

  const item = ticket.data?.items?.[0];
  if (!item?.upload_url || !item?.file_path) {
    throw new Error('لم يُرجع Magic Hour رابط رفع صالحاً للصورة.');
  }

  // Signed upload URL: raw bytes only; do not send the API bearer token.
  await axios.put(item.upload_url, file.buffer, {
    headers: { 'Content-Length': file.buffer.length },
    timeout: 120000,
    maxBodyLength: Infinity
  });

  return item.file_path;
}

function normalizeMagicStatus(data) {
  const raw = String(data?.status || data?.state || data?.project_status || '').toLowerCase();
  const failed = ['failed', 'error', 'cancelled', 'canceled'].includes(raw);
  const complete = ['complete', 'completed', 'success', 'succeeded', 'finished'].includes(raw);
  const url =
    data?.video_url ||
    data?.output_url ||
    data?.url ||
    data?.result?.video_url ||
    data?.result?.url ||
    data?.outputs?.[0]?.url ||
    data?.assets?.[0]?.url ||
    null;

  let status = failed ? 'failed' : complete && url ? 'completed' : 'processing';
  let progress = Number(data?.progress);
  if (!Number.isFinite(progress)) progress = status === 'completed' ? 100 : 0;

  const error = complete && !url
    ? 'المزود أعلن انتهاء المهمة لكنه لم يرجع رابط الفيديو.'
    : data?.error?.message || data?.message || null;

  return { status, progress, url, error };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Agnes Studio',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    providers: {
      agnes: Boolean(AGNES_API_KEY),
      magicHour: Boolean(MAGIC_HOUR_API_KEY)
    },
    videoUploadFix: 'magic-hour-signed-upload'
  });
});

app.post('/api/generate-image', upload.array('referenceImages', 5), async (req, res) => {
  try {
    if (!agnesClient) return res.status(503).json({ error: 'مفتاح AGNES_API_KEY غير مضبوط على Render.' });

    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'اكتب وصف الصورة أولاً.' });

    const payload = {
      model: 'agnes-image-2.5-flash',
      prompt,
      size: ['1K', '2K', '4K'].includes(req.body.size) ? req.body.size : '2K',
      ratio: ['16:9', '9:16', '1:1'].includes(req.body.ratio) ? req.body.ratio : '16:9',
      extra_body: { response_format: 'url' }
    };

    if (req.files?.length) {
      payload.extra_body.image = req.files.map(file =>
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    const response = await agnesClient.post('/images/generations', payload);
    const url = response.data?.data?.[0]?.url || response.data?.url;
    if (!url) throw new Error('لم يرجع مزود الصور رابطاً للصورة الناتجة.');

    res.json({ url, provider: 'Agnes AI' });
  } catch (error) {
    const info = safeProviderError(error);
    console.error('Image generation failed:', info);
    res.status(error.response?.status || 502).json({ error: publicError(error), providerError: info.code });
  }
});

async function startAgnesVideo({ prompt, mode, seconds, ratio, files }) {
  if (!agnesClient) throw new Error('AGNES_API_KEY is not configured.');

  const payload = {
    model: 'agnes-video-2.5',
    prompt,
    mode: mode === 'keyframe' ? 'keyframe' : 'text',
    seconds: String(seconds),
    size: '720P',
    aspect_ratio: ratio,
    n: 1
  };

  if (mode === 'keyframe') {
    if (!files?.length) throw new Error('وضع صورة إلى فيديو يتطلب صورة واحدة على الأقل.');
    payload.first_frame = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;
    if (files[1]) {
      payload.last_frame = `data:${files[1].mimetype};base64,${files[1].buffer.toString('base64')}`;
    }
  }

  const response = await agnesClient.post('/videos', payload);
  const id = response.data?.video_id || response.data?.id || response.data?.task_id;
  if (!id) throw new Error('Agnes AI لم يرجع معرف المهمة.');

  tasks.set(String(id), {
    provider: 'agnes',
    pollUrl: `https://apihub.agnes-ai.com/agnesapi?video_id=${encodeURIComponent(id)}&model_name=agnes-video-2.5`,
    createdAt: Date.now()
  });

  return { video_id: String(id), provider: 'Agnes AI' };
}

async function startMagicVideo({ prompt, mode, seconds, ratio, files }) {
  if (!magicClient) throw new Error('MAGIC_HOUR_API_KEY is not configured.');

  const common = {
    name: `Agnes Studio - ${new Date().toISOString()}`,
    model: 'ltx-2.5',
    end_seconds: Number(seconds),
    resolution: '480p',
    audio: true,
    style: { prompt }
  };

  let endpoint;
  let payload = common;

  if (mode === 'keyframe') {
    if (!files?.length) throw new Error('وضع صورة إلى فيديو يتطلب صورة واحدة على الأقل.');
    const filePath = await uploadImageToMagicHour(files[0]);
    endpoint = '/image-to-video';
    payload = {
      ...common,
      assets: { image_file_path: filePath }
    };
  } else {
    endpoint = '/text-to-video';
    payload = {
      ...common,
      aspect_ratio: ratio
    };
  }

  const response = await magicClient.post(endpoint, payload);
  const id = response.data?.id || response.data?.project_id || response.data?.video_id;
  if (!id) throw new Error('Magic Hour لم يرجع معرف المشروع.');

  tasks.set(String(id), {
    provider: 'magichour',
    createdAt: Date.now()
  });

  return { video_id: String(id), provider: 'Magic Hour' };
}

app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  const mode = req.body.mode === 'keyframe' ? 'keyframe' : 'text';
  const seconds = Number.parseInt(req.body.seconds || '4', 10);
  const ratio = ['16:9', '9:16', '1:1'].includes(req.body.ratio) ? req.body.ratio : '16:9';

  if (!prompt) return res.status(400).json({ error: 'اكتب وصف الفيديو أولاً.' });
  if (![4, 8, 12, 15, 30].includes(seconds)) {
    return res.status(400).json({ error: 'المدة المختارة غير مدعومة.' });
  }
  if (mode === 'keyframe' && !req.files?.length) {
    return res.status(400).json({ error: 'ارفع صورة للبدء في وضع صورة إلى فيديو.' });
  }

  const failures = [];

  // Agnes supports the short-duration route in this app. Quota/rate-limit
  // failures are recorded, then the fallback is attempted without retry loops.
  if (seconds <= 12 && agnesClient) {
    try {
      console.log(`Starting Agnes video (${seconds}s, ${mode})`);
      const result = await startAgnesVideo({ prompt, mode, seconds, ratio, files: req.files });
      return res.json({ ...result, status: 'pending' });
    } catch (error) {
      const info = safeProviderError(error);
      failures.push({ provider: 'Agnes AI', ...info });
      console.error('Agnes video failed:', info);
    }
  }

  if (magicClient) {
    try {
      console.log(`Starting Magic Hour video (${seconds}s, ${mode})`);
      const result = await startMagicVideo({ prompt, mode, seconds, ratio, files: req.files });
      return res.json({ ...result, status: 'pending' });
    } catch (error) {
      const info = safeProviderError(error);
      failures.push({ provider: 'Magic Hour', ...info });
      console.error('Magic Hour video failed:', info);
    }
  }

  const message = failures.length
    ? failures.map(f => `${f.provider}: ${f.message}`).join(' | ')
    : 'لا يوجد مزود فيديو مضبوط. أضف AGNES_API_KEY أو MAGIC_HOUR_API_KEY في Render.';
  res.status(502).json({ error: message, failures });
});

app.get('/api/video-status', async (req, res) => {
  const id = String(req.query.video_id || '');
  if (!id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

  const task = tasks.get(id);
  if (!task) {
    return res.status(404).json({
      error: 'لم أجد المهمة في ذاكرة الخادم. ربما أُعيد تشغيل Render؛ ابدأ طلب توليد جديد.'
    });
  }

  try {
    if (task.provider === 'agnes') {
      const response = await axios.get(task.pollUrl, {
        headers: { Authorization: `Bearer ${AGNES_API_KEY}` },
        timeout: 30000
      });
      const data = response.data || {};
      const status = String(data.status || '').toLowerCase();
      const completed = ['complete', 'completed', 'success', 'succeeded', 'finished'].includes(status);
      const failed = ['failed', 'error', 'cancelled', 'canceled'].includes(status);
      const url = data.url || data.video_url || data.output_url || data.result?.url || null;
      return res.json({
        status: failed ? 'failed' : completed && url ? 'completed' : 'processing',
        progress: Number(data.progress) || (url ? 100 : 0),
        url,
        error: completed && !url
          ? 'المزود أعلن انتهاء المهمة دون إرجاع رابط الفيديو.'
          : data.error?.message || data.message || null
      });
    }

    if (task.provider === 'magichour') {
      const response = await magicClient.get(`/video-projects/${encodeURIComponent(id)}`, { timeout: 30000 });
      return res.json(normalizeMagicStatus(response.data || {}));
    }

    return res.status(400).json({ error: 'مزود المهمة غير معروف.' });
  } catch (error) {
    const info = safeProviderError(error);
    console.error('Video status check failed:', info);
    return res.status(502).json({ error: publicError(error), providerError: info.code });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: `مسار API غير موجود: ${req.method} ${req.path}` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agnes Studio 1.1.0 listening on port ${PORT}`);
});
