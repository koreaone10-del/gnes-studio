require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const AGNES_API_KEY = process.env.AGNES_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';

if (!AGNES_API_KEY) {
  console.error('خطأ: مفتاح AGNES_API_KEY غير موجود.');
  process.exit(1);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const agnesClient = axios.create({
  baseURL: AGNES_BASE_URL,
  headers: {
    'Authorization': `Bearer ${AGNES_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ---------- توليد الصور (هذا الجزء يعمل بشكل صحيح) ----------
app.post('/api/generate-image', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, size, ratio, mode } = req.body;
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
    res.status(500).json({ error: 'فشل توليد الصورة.' });
  }
});

// ---------- توليد الفيديو (تم تصحيحه) ----------
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, mode, seconds, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    // بناء الحمولة (Payload) وفقاً للتوثيق الرسمي
    const payload = {
      model: 'agnes-video-2.5-flash',
      prompt: prompt,
      mode: mode || 'text',
      seconds: String(seconds || '4'), // يجب أن تكون سلسلة نصية
      size: '720P',                    // Flash يدعم 720P فقط
      aspect_ratio: ratio || '16:9',
      n: 1,
    };

    // معالجة الصور حسب الوضع
    if (mode === 'keyframe' && req.files && req.files.length >= 1) {
      // وضع الإطارات الرئيسية: الصورة الأولى هي الإطار الأول
      payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
      // إذا تم رفع صورة ثانية، تكون هي الإطار الأخير
      if (req.files.length >= 2) {
        payload.last_frame = `data:${req.files[1].mimetype};base64,${req.files[1].buffer.toString('base64')}`;
      }
    } else if (mode === 'reference' && req.files && req.files.length > 0) {
      // وضع المراجع البصرية
      payload.images = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    // إرسال الطلب إلى نقطة النهاية الصحيحة لإنشاء المهمة
    const createResponse = await agnesClient.post('/videos', payload);
    
    // استخراج video_id من الاستجابة (التوثيق يشير إلى أنه الحقل الأساسي)
    const videoId = createResponse.data.video_id || createResponse.data.id || createResponse.data.task_id;
    if (!videoId) {
      console.error('استجابة غير متوقعة من إنشاء الفيديو:', createResponse.data);
      throw new Error('لم يتم إرجاع معرف الفيديو.');
    }

    res.json({ video_id: videoId, status: 'pending' });
  } catch (error) {
    console.error('خطأ في إنشاء مهمة الفيديو:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل بدء توليد الفيديو.' });
  }
});

// ---------- التحقق من حالة الفيديو (تم تصحيحه) ----------
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    // نقطة النهاية الصحيحة للاستعلام عن الحالة (ليست تحت /v1)
    const pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${video_id}&model_name=agnes-video-2.5-flash`;
    
    const response = await axios.get(pollUrl, {
      headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` },
    });

    const data = response.data;
    
    // استخراج الحالة والرابط
    const status = data.status;
    const progress = data.progress || 0;
    // الرابط موجود في المستوى الأعلى أو في metadata.url
    const videoUrl = data.url || (data.metadata && data.metadata.url) || null;

    res.json({
      status: status,
      url: videoUrl,
      progress: progress,
    });
  } catch (error) {
    console.error('خطأ في التحقق من الحالة:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل التحقق من الحالة.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
