require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const AGNES_API_KEY = process.env.AGNES_API_KEY;
const MAGIC_HOUR_API_KEY = process.env.MAGIC_HOUR_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const MAGIC_HOUR_BASE_URL = 'https://api.magichour.ai/v1';

if (!AGNES_API_KEY) {
  console.error('خطأ: مفتاح AGNES_API_KEY غير موجود.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const agnesClient = axios.create({
  baseURL: AGNES_BASE_URL,
  headers: { 'Authorization': `Bearer ${AGNES_API_KEY}`, 'Content-Type': 'application/json' },
});

const magicHourClient = axios.create({
  baseURL: MAGIC_HOUR_BASE_URL,
  headers: { 'Authorization': `Bearer ${MAGIC_HOUR_API_KEY}`, 'Content-Type': 'application/json' },
});

// ==========================================
// 1. توليد الصور (يبقى على Agnes)
// ==========================================
app.post('/api/generate-image', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, size, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const payload = {
      model: 'agnes-image-2.5-flash',
      prompt: prompt,
      size: size || '2K',
      ratio: ratio || '16:9',
      extra_body: { response_format: 'url' },
    };

    if (req.files && req.files.length > 0) {
      payload.extra_body.image = req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
    }

    const response = await agnesClient.post('/images/generations', payload);
    res.json({ url: response.data.data[0].url });
  } catch (error) {
    console.error('خطأ في توليد الصورة:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || 'فشل توليد الصورة.' });
  }
});

// ==========================================
// 2. توليد الفيديو (نظام التوجيه الذكي Smart Router)
// ==========================================
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  const { prompt, mode, seconds, ratio } = req.body;
  if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

  const requestedSeconds = parseInt(seconds || '4');
  const providers = [];

  // إعداد Agnes AI كخيار أول (يدعم حتى 18 ثانية مع نموذج v2.0)
  if (AGNES_API_KEY) {
    let agnesModel = 'agnes-video-2.5-flash';
    let agnesMaxSeconds = 12;
    if (requestedSeconds > 12 && requestedSeconds <= 18) {
      agnesModel = 'agnes-video-v2.0';
      agnesMaxSeconds = 18;
    }

    if (requestedSeconds <= agnesMaxSeconds) {
      const payload = {
        model: agnesModel,
        prompt: prompt,
        mode: mode || 'text',
        seconds: String(requestedSeconds),
        size: '720P',
        aspect_ratio: ratio || '16:9',
        n: 1,
      };

      if (mode === 'keyframe' && req.files?.length > 0) {
        payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
        if (req.files.length > 1) payload.last_frame = `data:${req.files[1].mimetype};base64,${req.files[1].buffer.toString('base64')}`;
      } else if (mode === 'reference' && req.files?.length > 0) {
        payload.images = req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`);
      }

      providers.push({
        name: 'Agnes AI',
        type: 'agnes',
        execute: () => agnesClient.post('/videos', payload),
        extractId: (data) => data.video_id || data.id || data.task_id,
        pollUrl: (id) => `https://apihub.agnes-ai.com/agnesapi?video_id=${id}&model_name=${agnesModel}`,
      });
    }
  }

  // إعداد Magic Hour كخيار احتياطي
  if (MAGIC_HOUR_API_KEY) {
    // Magic Hour يدعم النماذج بمدة تصل إلى 30 أو 60 ثانية
    const mhModel = requestedSeconds > 20 ? 'ltx-2.3' : 'wan-2.2';
    const mhSeconds = Math.min(requestedSeconds, 30);
    
    const payload = {
      model: mhModel,
      prompt: prompt,
      duration: mhSeconds,
      resolution: '720p',
      aspect_ratio: ratio || '16:9',
    };

    if (mode === 'keyframe' && req.files?.length > 0) {
      payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
    }

    providers.push({
      name: 'Magic Hour',
      type: 'magichour',
      execute: () => magicHourClient.post('/videos/generate', payload),
      extractId: (data) => data.project_id || data.id,
      pollUrl: (id) => `/video-status-mh?id=${id}`,
    });
  }

  if (providers.length === 0) {
    return res.status(400).json({ error: 'المدة المطلوبة غير مدعومة من المزودين المتاحين.' });
  }

  // محاولة التوليد باستخدام أول مزود متاح
  let lastError = null;
  for (const provider of providers) {
    try {
      console.log(`محاولة التوليد باستخدام: ${provider.name}`);
      const response = await provider.execute();
      const videoId = provider.extractId(response.data);
      
      if (!videoId) throw new Error('لم يتم إرجاع معرف الفيديو.');

      // حفظ معلومات المزود في الذاكرة المؤقتة (للتحقق من الحالة لاحقاً)
      global.videoTasks = global.videoTasks || {};
      global.videoTasks[videoId] = { provider: provider.type, pollUrl: provider.pollUrl(videoId) };

      return res.json({ video_id: videoId, status: 'pending', provider: provider.name });
    } catch (error) {
      console.error(`فشل المزود ${provider.name}:`, error.response?.data || error.message);
      lastError = error;
    }
  }

  // إذا فشلت كل المحاولات
  res.status(500).json({ error: lastError?.response?.data?.message || lastError?.message || 'فشل جميع المزودين في توليد الفيديو.' });
});

// ==========================================
// 3. التحقق من حالة الفيديو (Dynamic Status Polling)
// ==========================================
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    const taskInfo = global.videoTasks?.[video_id];
    if (!taskInfo) return res.status(404).json({ error: 'المهمة غير موجودة.' });

    let response;
    if (taskInfo.provider === 'agnes') {
      response = await axios.get(taskInfo.pollUrl, { headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` } });
      const data = response.data;
      return res.json({ status: data.status, url: data.url || null, progress: data.progress || 0 });
    } 
    
    if (taskInfo.provider === 'magichour') {
      // Magic Hour يستخدم نقطة نهاية مختلفة للاستعلام
      const mhUrl = `https://api.magichour.ai/v1/video-status/${video_id}`;
      response = await axios.get(mhUrl, { headers: { 'Authorization': `Bearer ${MAGIC_HOUR_API_KEY}` } });
      const data = response.data;
      // تحويل حالة Magic Hour إلى صيغة موحدة
      const statusMap = { 'complete': 'completed', 'processing': 'processing', 'error': 'failed' };
      return res.json({ status: statusMap[data.status] || data.status, url: data.video_url || null, progress: data.progress || 0 });
    }

    res.status(400).json({ error: 'مزود غير معروف.' });
  } catch (error) {
    console.error('خطأ في التحقق من الحالة:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل التحقق من الحالة.' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.listen(PORT, () => console.log(`الخادم يعمل على المنفذ ${PORT}`));
