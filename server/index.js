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
  console.error('خطأ: مفتاح AGNES_API_KEY غير موجود في متغيرات البيئة.');
  process.exit(1);
}

// إعداد Multer لرفع الصور (المراجع) إلى الذاكرة مؤقتاً
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// دالة مساعدة لإرسال الطلبات إلى Agnes AI
const agnesClient = axios.create({
  baseURL: AGNES_BASE_URL,
  headers: {
    'Authorization': `Bearer ${AGNES_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ---------- مسارات API ----------

// 1. توليد الصور (نص إلى صورة أو صورة إلى صورة)
app.post('/api/generate-image', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, size, ratio, mode } = req.body; // mode: 'text' أو 'image'
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const payload = {
      model: 'agnes-image-2.5-flash',
      prompt: prompt,
      size: size || '2K',
      ratio: ratio || '16:9',
      extra_body: {
        response_format: 'url', // إرجاع رابط الصورة
      },
    };

    // إذا كان هناك صور مرجعية مرفوعة، أضفها إلى الطلب
    if (req.files && req.files.length > 0) {
      payload.extra_body.image = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    const response = await agnesClient.post('/images/generations', payload);
    res.json({ url: response.data.data[0].url });
  } catch (error) {
    console.error('خطأ في توليد الصورة:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل توليد الصورة. تحقق من المدخلات وحاول مجدداً.' });
  }
});

// 2. توليد الفيديو (نص إلى فيديو، أو مع إطارات مرجعية)
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, mode, seconds, ratio } = req.body; // mode: 'text' أو 'keyframe' أو 'reference'
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const payload = {
      model: 'agnes-video-2.5-flash',
      prompt: prompt,
      mode: mode || 'text',
      seconds: seconds || '4',
      size: '720P', // الوحيد المتاح في Flash
      aspect_ratio: ratio || '16:9',
      n: 1,
    };

    // التعامل مع الإطارات الرئيسية (keyframe) إذا تم رفع صورتين (أول وأخير)
    if (mode === 'keyframe' && req.files && req.files.length >= 2) {
      payload.first_frame = `data:${req.files[0].mimetype};base64,${req.files[0].buffer.toString('base64')}`;
      payload.last_frame = `data:${req.files[1].mimetype};base64,${req.files[1].buffer.toString('base64')}`;
    } 
    // التعامل مع المراجع البصرية (reference)
    else if (mode === 'reference' && req.files && req.files.length > 0) {
      payload.images = req.files.map(file => 
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      );
    }

    const createResponse = await agnesClient.post('/videos', payload);
    const videoId = createResponse.data.video_id; // أو createResponse.data.id
    if (!videoId) {
      throw new Error('لم يتم إرجاع معرف الفيديو من الخادم.');
    }

    res.json({ video_id: videoId, status: 'pending' });
  } catch (error) {
    console.error('خطأ في إنشاء مهمة الفيديو:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل بدء توليد الفيديو. تحقق من المدخلات.' });
  }
});

// 3. التحقق من حالة الفيديو (Polling)
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    const pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${video_id}&model_name=agnes-video-2.5-flash`;
    const response = await axios.get(pollUrl, {
      headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` },
    });

    const data = response.data;
    // التوثيق يشير إلى أن الحالة النهائية تكون في status، والرابط في url
    res.json({
      status: data.status, // مثلاً 'completed' أو 'failed' أو 'processing'
      url: data.url || null,
      progress: data.progress || 0,
    });
  } catch (error) {
    console.error('خطأ في التحقق من حالة الفيديو:', error.response?.data || error.message);
    res.status(500).json({ error: 'فشل التحقق من الحالة.' });
  }
});

// جميع المسارات الأخرى تعيد index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
