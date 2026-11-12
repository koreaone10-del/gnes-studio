require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const AGNES_API_KEY = process.env.AGNES_API_KEY;
const MAGIC_HOUR_API_KEY = process.env.MAGIC_HOUR_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const MAGIC_HOUR_BASE_URL = 'https://api.magichour.ai/v1';

if (!AGNES_API_KEY) {
  console.error('❌ خطأ: مفتاح AGNES_API_KEY غير موجود.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// عميل Agnes
const agnesClient = axios.create({
  baseURL: AGNES_BASE_URL,
  headers: { 'Authorization': `Bearer ${AGNES_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 120000,
});

// عميل Magic Hour (اختياري)
const magicHourClient = MAGIC_HOUR_API_KEY ? axios.create({
  baseURL: MAGIC_HOUR_BASE_URL,
  headers: { 'Authorization': `Bearer ${MAGIC_HOUR_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 120000,
}) : null;

// ==========================================
// 0. مسار صحي للاختبار
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    agnesKey: !!AGNES_API_KEY,
    magicHourKey: !!MAGIC_HOUR_API_KEY
  });
});

// ==========================================
// 1. توليد الصور
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
      payload.extra_body.image = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    const response = await agnesClient.post('/images/generations', payload);
    res.json({ url: response.data.data[0].url });
  } catch (error) {
    console.error('خطأ في توليد الصورة:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || 'فشل توليد الصورة.' });
  }
});

// ==========================================
// 2. توليد الفيديو (نظام التوجيه المحدث)
// ==========================================
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, mode, seconds, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const requestedSeconds = parseInt(seconds || '4');
    let lastError = null;

    // --- الخيار 1: Agnes AI (يدعم حتى 12 ثانية) ---
    // نستخدمه فقط إذا كانت المدة 12 ثانية أو أقل
    if (AGNES_API_KEY && requestedSeconds <= 12) {
      try {
        console.log(`🔄 محاولة التوليد باستخدام Agnes AI (المدة: ${requestedSeconds} ثانية)`);
        
        const payload = {
          model: 'agnes-video-2.5', // النموذج الصحيح والمدعوم حالياً
          prompt: prompt,
          mode: mode || 'text',
          seconds: String(requestedSeconds),
          size: '720P',
          aspect_ratio: ratio || '16:9',
          n: 1,
        };

        if (mode === 'keyframe' && req.files?.length > 0) {
          payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
          if (req.files.length > 1) {
            payload.last_frame = `data:${req.files[1].mimetype};base64,${req.files[1].buffer.toString('base64')}`;
          }
        } else if (mode === 'reference' && req.files?.length > 0) {
          payload.images = req.files.map(file => 
            `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
          );
        }

        const response = await agnesClient.post('/videos', payload);
        const videoId = response.data.video_id || response.data.id || response.data.task_id;
        
        if (!videoId) throw new Error('لم يتم إرجاع معرف الفيديو من Agnes.');

        // حفظ المهمة في الذاكرة
        global.videoTasks = global.videoTasks || {};
        global.videoTasks[videoId] = { 
          provider: 'agnes', 
          pollUrl: `https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5`
        };

        console.log(`✅ نجح Agnes AI. المعرف: ${videoId}`);
        return res.json({ video_id: videoId, status: 'pending', provider: 'Agnes AI' });

      } catch (error) {
        console.error(`❌ فشل Agnes AI:`, error.response?.data || error.message);
        lastError = error;
      }
    }

    // --- الخيار 2: Magic Hour (للمدد الأطول أو كبديل) ---
    if (magicHourClient) {
      try {
        console.log(`🔄 محاولة التوليد باستخدام Magic Hour (المدة: ${requestedSeconds} ثانية)`);
        
        // Magic Hour يستخدم مسارات مختلفة حسب الوضع
        let mhUrl, payload;

        if (mode === 'keyframe' && req.files?.length > 0) {
          // صورة إلى فيديو
          mhUrl = '/image-to-video';
          payload = {
            model: 'ltx-2.3', // نموذج يدعم مدداً أطول
            end_seconds: Math.min(requestedSeconds, 30),
            resolution: '720p',
            aspect_ratio: ratio || '16:9',
            style: { prompt: prompt },
            assets: {
              image_file_path: `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`
            }
          };
        } else {
          // نص إلى فيديو
          mhUrl = '/text-to-video';
          payload = {
            model: 'ltx-2.3',
            end_seconds: Math.min(requestedSeconds, 30),
            resolution: '720p',
            aspect_ratio: ratio || '16:9',
            style: { prompt: prompt }
          };
        }

        const response = await magicHourClient.post(mhUrl, payload);
        const videoId = response.data.project_id || response.data.id;
        
        if (!videoId) throw new Error('لم يتم إرجاع معرف الفيديو من Magic Hour.');

        global.videoTasks = global.videoTasks || {};
        global.videoTasks[videoId] = { 
          provider: 'magichour', 
          pollUrl: `/video-status-mh?id=${videoId}` 
        };

        console.log(`✅ نجح Magic Hour. المعرف: ${videoId}`);
        return res.json({ video_id: videoId, status: 'pending', provider: 'Magic Hour' });

      } catch (error) {
        console.error(`❌ فشل Magic Hour:`, error.response?.data || error.message);
        lastError = error;
      }
    }

    // إذا فشلت كل المحاولات
    if (requestedSeconds > 12 && !magicHourClient) {
      return res.status(400).json({ 
        error: 'المدد التي تتجاوز 12 ثانية تتطلب إضافة مفتاح Magic Hour. يرجى إضافته في متغيرات البيئة.' 
      });
    }

    res.status(500).json({ 
      error: lastError?.response?.data?.message || lastError?.message || 'فشل جميع المزودين في توليد الفيديو.' 
    });

  } catch (error) {
    console.error('خطأ غير متوقع في مسار الفيديو:', error);
    res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم.' });
  }
});

// ==========================================
// 3. التحقق من حالة الفيديو
// ==========================================
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    const taskInfo = global.videoTasks?.[video_id];
    if (!taskInfo) {
      return res.status(404).json({ error: 'المهمة غير موجودة أو تم إعادة تشغيل الخادم. يرجى بدء توليد جديد.' });
    }

    if (taskInfo.provider === 'agnes') {
      const response = await axios.get(taskInfo.pollUrl, {
        headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` },
      });
      const data = response.data;
      return res.json({ status: data.status, url: data.url || null, progress: data.progress || 0 });
    } 
    
    if (taskInfo.provider === 'magichour') {
      // المسار الصحيح للاستعلام عن حالة المشروع في Magic Hour
      const mhUrl = `https://api.magichour.ai/v1/video-projects/${video_id}`;
      const response = await axios.get(mhUrl, {
        headers: { 'Authorization': `Bearer ${MAGIC_HOUR_API_KEY}` },
      });
      const data = response.data;
      const statusMap = { 'complete': 'completed', 'processing': 'processing', 'error': 'failed' };
      return res.json({ 
        status: statusMap[data.status] || data.status, 
        url: data.video_url || null, 
        progress: data.progress || 0 
      });
    }

    res.status(400).json({ error: 'مزود غير معروف.' });
  } catch (error) {
    console.error('خطأ في التحقق من الحالة:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل التحقق من الحالة.' });
  }
});

// ==========================================
// 4. معالجة المسارات غير الموجودة (لـ API فقط)
// ==========================================
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `المسار ${req.originalUrl} غير موجود على الخادم.` });
});

// ==========================================
// 5. تقديم الواجهة الأمامية
// ==========================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
});
