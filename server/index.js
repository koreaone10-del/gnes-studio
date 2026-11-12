require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const FormData = require('form-data');

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

// دالة لرفع الصور إلى استضافة مؤقتة للحصول على رابط عام (مطلوب للفيديو)
async function uploadImageToTempHost(file) {
  try {
    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    const response = await axios.post('https://0x0.st', form, {
      headers: { ...form.getHeaders() },
      maxBodyLength: Infinity,
    });
    return response.data.trim();
  } catch (error) {
    console.error('خطأ في رفع الصورة:', error.message);
    throw new Error('فشل رفع الصورة للخادم المؤقت.');
  }
}

// ---------- توليد الصور ----------
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
      // توليد الصور يدعم Base64 كما كان يعمل سابقاً
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

// ---------- توليد الفيديو ----------
app.post('/api/generate-video', upload.array('referenceImages', 5), async (req, res) => {
  try {
    const { prompt, mode, seconds, ratio } = req.body;
    if (!prompt) return res.status(400).json({ error: 'البرومبت مطلوب.' });

    const payload = {
      model: 'agnes-video-2.5-flash',
      prompt: prompt,
      mode: mode || 'text',
      seconds: String(seconds || '4'),
      size: '720P',
      aspect_ratio: ratio || '16:9',
      n: 1,
    };

    if (req.files && req.files.length > 0) {
      // الفيديو يتطلب روابط عامة (URLs) كما في التوثيق
      const imageUrls = await Promise.all(req.files.map(file => uploadImageToTempHost(file)));
      
      if (mode === 'keyframe') {
        payload.first_frame = imageUrls[0];
        if (imageUrls.length > 1) {
          payload.last_frame = imageUrls[1];
        }
      } else if (mode === 'reference') {
        payload.images = imageUrls;
      }
    }

    const createResponse = await agnesClient.post('/videos', payload);
    const videoId = createResponse.data.video_id || createResponse.data.id || createResponse.data.task_id;
    
    if (!videoId) {
      console.error('استجابة غير متوقعة:', createResponse.data);
      throw new Error('لم يتم إرجاع معرف الفيديو.');
    }

    res.json({ video_id: videoId, status: 'pending' });
  } catch (error) {
    console.error('خطأ في إنشاء مهمة الفيديو:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.message || error.message || 'فشل بدء توليد الفيديو.' });
  }
});

// ---------- التحقق من حالة الفيديو ----------
app.get('/api/video-status', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).json({ error: 'معرف الفيديو مطلوب.' });

    const pollUrl = `https://apihub.agnes-ai.com/agnesapi?video_id=${video_id}&model_name=agnes-video-2.5-flash`;
    
    const response = await axios.get(pollUrl, {
      headers: { 'Authorization': `Bearer ${AGNES_API_KEY}` },
    });

    const data = response.data;
    res.json({
      status: data.status,
      url: data.url || null,
      progress: data.progress || 0,
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
